/**
 * Unified Audit Log — same schema regardless of provider, pluggable
 * by backend so the same code runs locally and in production.
 *
 * AUDIT_STORE=file      (default) — JSON file, fine for local dev and
 *                        single-instance deployments.
 * AUDIT_STORE=dynamodb  — real persisted state that's safe across
 *                        multiple ECS tasks / Lambda invocations.
 */

const backend = (process.env.AUDIT_STORE || 'file').toLowerCase();

const store = backend === 'dynamodb'
  ? require('./stores/dynamoStore')
  : require('./stores/fileStore');

module.exports = {
  recordEvent: store.recordEvent,
  getAllEvents: store.getAllEvents,
  healthCheck: store.healthCheck,
  backend,
};
