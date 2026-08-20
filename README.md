# Guardrail Engine

**Live demo:** https://guardrail-engine-production.onrender.com

A single safety policy — PII redaction, toxicity blocking, topic denial —
defined **once** and enforced **identically** across multiple LLM providers.
Ships as a containerized service with a real API, structured logging, and
a health check, ready to deploy rather than run only on a laptop.

## Why this exists

Enterprises running multiple LLM providers (OpenAI, Anthropic, self-hosted
models) normally re-implement the same safety rules separately for each
one — which drifts out of sync and leaves gaps. Guardrail Engine decouples
the policy from the provider: write a rule once, add a new provider by
writing one small adapter file, and the policy logic never changes.

## Project structure

guardrail-engine/
├── policies/
│ ├── base-policy.yaml # the ONE policy definition
│ └── overlays/ # provider overlays (restrict-only)
│ ├── gemini-overlay.yaml
│ └── groq-overlay.yaml
├── src/
│ ├── detectors/ # PII, toxicity, topic checks (provider-agnostic)
│ ├── providers/ # groqProvider.js, geminiProvider.js, registry.js
│ ├── policy/ # policyLoader.js (inheritance), policyEngine.js
│ ├── audit/
│ │ ├── auditLog.js # picks a backend by env var
│ │ └── stores/ # fileStore.js (local) / dynamoStore.js (AWS)
│ └── server.js # Express API, health check, logging, shutdown
├── public/index.html # dashboard
├── deploy/ # AWS ECS task def + DynamoDB setup script (reference; live deployment is on Render)
├── Dockerfile
├── docker-compose.yml
└── .env.example


## What's included

| Area | Details |
|---|---|
| Deployment | `Dockerfile` builds a container; deployed live on Render. Also compatible with AWS ECS Fargate, App Runner, EKS, or any Docker host — configs included in `deploy/` |
| Concurrency | Node's event loop handles concurrent requests natively; audit writes are serialized to avoid a read-modify-write race |
| State | File store for local/single-instance use; DynamoDB store (`AUDIT_STORE=dynamodb`) scaffolded for state that survives restarts and stays consistent across multiple instances |
| API | REST — `/api/chat`, `/api/audit`, `/api/policy`, `/api/policy-comparison` |
| Logging | Structured JSON logs via `pino`/`pino-http` |
| Error handling | Input validation, centralized error handler, provider errors kept out of client-facing messages |
| Health check | `/health` checks policy files load, the audit backend is reachable, and providers are registered — returns `503` if something is actually broken |
| PII types | Email, phone, credit card, SSN, Aadhaar, and free-text addresses (regex-based) |
| LLM providers | Calls real Groq/Gemini APIs when API keys are set; falls back to deterministic mock responses when they're not, so it's fully testable at zero cost |

## Run it locally

```bash
npm install
cp .env.example .env
npm start
```

Open **http://localhost:3001**.

## Run it in a container

```bash
docker compose up --build
```

Builds and runs the same image you'd deploy to production, with a
persistent volume for the audit log.

## Deployed on Render

The live demo above is deployed on [Render](https://render.com), built
straight from this repo's `Dockerfile`:
- Service points at this repo — Render auto-detects the `Dockerfile`.
- `GROQ_API_KEY` / `GEMINI_API_KEY` set as environment variables in
  Render's dashboard.
- Public HTTPS URL, no AWS account needed.

## AWS deployment (reference architecture)

The `deploy/` folder contains a complete AWS deployment path
(ECS Fargate + DynamoDB), included to demonstrate the production
architecture even though the live demo runs on Render for this
submission.

### Option A — App Runner (fastest, least infrastructure)

```bash
# Build and push the image to ECR
aws ecr create-repository --repository-name guardrail-engine
docker build -t guardrail-engine .
aws ecr get-login-password | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
docker tag guardrail-engine:latest <account-id>.dkr.ecr.<region>.amazonaws.com/guardrail-engine:latest
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/guardrail-engine:latest

# Create an App Runner service from that image
aws apprunner create-service --service-name guardrail-engine \
  --source-configuration ImageRepository="{ImageIdentifier=<account-id>.dkr.ecr.<region>.amazonaws.com/guardrail-engine:latest,ImageRepositoryType=ECR,ImageConfiguration={Port=3001}}"
```

App Runner handles the load balancer, scaling, and HTTPS automatically.

### Option B — ECS Fargate (more control)

1. Push the image to ECR (as above).
2. Create the DynamoDB audit table (see below) and set `AUDIT_STORE=dynamodb`
   for multi-task persistence.
3. Register the task definition:
```bash
   aws ecs register-task-definition --cli-input-json file://deploy/ecs-task-definition.json
```
   Fill in your ECR image URI, task execution role, and (if using
   DynamoDB) a task role with `dynamodb:PutItem`/`dynamodb:Scan` on the
   table.
4. Create an ECS service (Fargate launch type) behind an Application
   Load Balancer targeting port 3001, with the ALB health check path
   set to `/health`.

### DynamoDB setup

```bash
./deploy/create-dynamodb-table.sh
```

Then set `AUDIT_STORE=dynamodb` in the environment (already set in
`deploy/ecs-task-definition.json`). The file store works fine for a
single instance, but multiple instances behind a load balancer would
each keep their own separate audit history without DynamoDB.

### Secrets

Store `GROQ_API_KEY` / `GEMINI_API_KEY` in AWS Secrets Manager, not in
the task definition or repo. `deploy/ecs-task-definition.json` already
references them via `secrets` (ARNs).

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check — policy load, audit backend, providers |
| GET | `/api/policy` | Base policy |
| GET | `/api/policy/:provider` | Effective policy for a provider (base + overlay) |
| GET | `/api/policy-comparison` | Base vs. every provider's effective policy, with diffs |
| POST | `/api/chat` | `{ provider, prompt }` → runs prompt through provider, then policy engine |
| GET | `/api/audit` | Unified audit log across all providers |

## Design notes

- **Same policy, every provider**: `policyEngine.js` never imports
  provider code — it only receives plain text, so behavior is
  identical regardless of source.
- **Unified audit log**: every entry, file-backed or DynamoDB-backed,
  uses the same schema regardless of `provider`.
- **Adding a new provider**: write one file with a `generate(prompt)`
  function, register it in `registry.js`. No changes to
  `policyEngine.js`, `server.js`, or the audit layer.
- **Policy inheritance**: overlays in `policies/overlays/` (one per
  provider: `gemini-overlay.yaml`, `groq-overlay.yaml`) can only
  *restrict* the base policy (e.g. lower a toxicity threshold). An
  overlay attempting to relax a rule is rejected at merge time and
  logged, enforced in `policyLoader.js`. `/api/policy-comparison`
  shows the effective policy per provider and any rejected
  relaxations.
- **Topic denial**: keyword + synonym-expanded cosine-similarity
  matching, catching paraphrases a pure keyword filter would miss.
- **PII detection**: regex-based, checked in priority order with
  overlap-avoidance so a single value (e.g. a 16-digit card number)
  is never double-tagged under two categories.
- **Mock mode**: fully usable with zero API cost when no provider keys
  are set.

## Known limitations

- The toxicity scorer is a weighted keyword list, not a trained
  classifier — cheap and fast, but will miss toxic phrasing that
  avoids the listed terms. Swapping in a real lightweight classifier
  only touches `src/detectors/toxicityDetector.js`.
- PII detection covers structured formats (email, phone, credit card,
  SSN, Aadhaar) and free-text addresses via regex; person names
  aren't detected, since names don't follow a reliable pattern and
  would need an NER model or LLM-based pass — a natural next step.
- `getAllEvents()` on the DynamoDB store does a full table scan, fine
  at low volume but should move to a paginated query on a date-based
  GSI at real production scale.
- Audit storage on the live demo is file-based (single Render
  instance), matching `AUDIT_STORE=file`; the DynamoDB path is
  implemented and AWS-deployment-ready but not exercised in this
  submission's live environment.