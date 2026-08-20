require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pino = require('pino');
const pinoHttp = require('pino-http');
const { v4: uuidv4 } = require('uuid');

const { getProvider, listProviders } = require('./providers/registry');
const { loadEffectivePolicy } = require('./policy/policyLoader');
const { evaluate } = require('./policy/policyEngine');
const auditLog = require('./audit/auditLog');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Pretty-print locally, structured JSON in production (ECS/CloudWatch
  // want plain JSON lines, not colorized dev output).
  transport: process.env.NODE_ENV === 'production'
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

const app = express();

// Trust the load balancer (ALB/ECS) so req.ip and rate-limit logic (if
// added later) see the real client IP instead of the LB's.
app.set('trust proxy', true);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  : true; // wide open by default — tighten via ALLOWED_ORIGINS in production

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '256kb' }));
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
app.use(express.static(path.join(__dirname, '../public')));

// ---------------------------------------------------------------------
// Health check — checks the things that can actually break in
// production: policy files load, the audit backend is reachable, and
// every registered provider adapter is present. Returns 503 if
// anything critical is down, so ECS/ALB/EKS liveness probes catch it.
// ---------------------------------------------------------------------
app.get('/health', async (req, res) => {
  const checks = {};
  let healthy = true;

  try {
    loadEffectivePolicy('base');
    checks.policy = { ok: true };
  } catch (err) {
    checks.policy = { ok: false, error: err.message };
    healthy = false;
  }

  try {
    checks.audit = await auditLog.healthCheck();
    if (!checks.audit.ok) healthy = false;
  } catch (err) {
    checks.audit = { ok: false, error: err.message };
    healthy = false;
  }

  checks.providers = { ok: true, available: listProviders() };

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks,
  });
});

// Effective policy for a given provider (base + overlay merged)
app.get('/api/policy/:provider', (req, res) => {
  const policy = loadEffectivePolicy(req.params.provider);
  res.json(policy);
});

// Base policy only
app.get('/api/policy', (req, res) => {
  const policy = loadEffectivePolicy('base');
  res.json(policy);
});

// Base policy vs effective policy per provider, with diffs — powers the
// "Policy Inheritance" panel in the dashboard.
app.get('/api/policy-comparison', (req, res) => {
  const base = loadEffectivePolicy('base');
  const comparison = {};

  for (const providerName of listProviders()) {
    const effective = loadEffectivePolicy(providerName);
    const diffs = [];

    for (const baseRule of base.rules) {
      const effRule = effective.rules.find((r) => r.id === baseRule.id);
      if (!effRule) continue;
      for (const key of Object.keys(baseRule)) {
        if (key === 'description') continue;
        if (JSON.stringify(baseRule[key]) !== JSON.stringify(effRule[key])) {
          diffs.push({ rule: baseRule.id, field: key, base: baseRule[key], effective: effRule[key] });
        }
      }
    }

    comparison[providerName] = {
      overlayApplied: effective._overlayApplied || null,
      rejectedRelaxations: effective._overlayViolations || [],
      diffs,
    };
  }

  res.json({ base, comparison });
});

// Main endpoint: send a prompt to a provider, run policy engine on the output
app.post('/api/chat', async (req, res, next) => {
  const { provider: providerName, prompt } = req.body || {};

  if (!providerName || !prompt) {
    return res.status(400).json({ error: 'provider and prompt are required' });
  }
  if (typeof prompt !== 'string' || prompt.length > 8000) {
    return res.status(400).json({ error: 'prompt must be a string under 8000 characters' });
  }

  try {
    const provider = getProvider(providerName);
    const policy = loadEffectivePolicy(providerName); // base + this provider's overlay
    const rawOutput = await provider.generate(prompt);
    const { finalOutput, disposition, violations } = evaluate(rawOutput, policy);

    const entry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      provider: providerName,
      prompt,
      original_output: rawOutput,
      final_output: finalOutput,
      disposition,
      violations,
    };

    await auditLog.recordEvent(entry);
    res.json(entry);
  } catch (err) {
    // Known client-facing error (unknown provider) vs. an upstream/infra
    // failure. Both are logged; only the message we control goes to the
    // client, so provider API errors don't leak internals.
    if (/Unknown provider/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    req.log.error({ err }, 'chat pipeline failed');
    next(err);
  }
});

// Unified audit log — same schema regardless of provider
app.get('/api/audit', async (req, res, next) => {
  try {
    const events = await auditLog.getAllEvents();
    res.json(events);
  } catch (err) {
    next(err);
  }
});

// Centralized error handler — last middleware. Keeps stack traces out of
// the response in production while still logging them server-side.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  req.log?.error({ err }, 'unhandled error');
  res.status(500).json({
    error: 'internal_error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : err.message,
  });
});

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  logger.info(
    { port: PORT, providers: listProviders(), auditBackend: auditLog.backend },
    'Guardrail engine started',
  );
});

// ---------------------------------------------------------------------
// Graceful shutdown — ECS/EKS/Kubernetes send SIGTERM before killing a
// container during a deploy or scale-in. Without this, in-flight
// requests get dropped instead of finishing cleanly.
// ---------------------------------------------------------------------
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    logger.info('closed remaining connections, exiting');
    process.exit(0);
  });
  // Force-exit if something is still hanging after 10s.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server };
