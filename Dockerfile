# Multi-stage build keeps the final image small (no dev deps, no build tools).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# Writable path for the default file-based audit store (see /app/data
# created + chowned below). Ignored entirely when AUDIT_STORE=dynamodb.
ENV AUDIT_LOG_PATH=/app/data/audit-log.json

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY policies ./policies

# The file-based audit store (default backend) needs a writable directory.
# Own it as the non-root 'node' user (already present in the base image)
# instead of running as root, which most container platforms flag.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3001

# ECS/ALB/EKS/Docker Compose all understand this natively.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
