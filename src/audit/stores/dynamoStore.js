/**
 * DynamoDB-backed audit store — the production backend for AWS deployments.
 *
 * Use this when running on ECS, EKS, or Lambda with more than one
 * instance/task: every task writes to the same table, so audit history
 * is consistent regardless of which task handled a given request, and
 * survives task restarts/redeploys (unlike the file store).
 *
 * Enable with: AUDIT_STORE=dynamodb  AUDIT_TABLE_NAME=guardrail-audit-log
 *
 * Table setup (see deploy/dynamodb-table.json or the README):
 *   Partition key: id (String)
 *   On-demand billing is fine for this workload.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.AUDIT_TABLE_NAME || 'guardrail-audit-log';
const REGION = process.env.AWS_REGION || 'us-east-1';

const client = new DynamoDBClient({ region: REGION });
const doc = DynamoDBDocumentClient.from(client);

async function recordEvent(entry) {
  await doc.send(new PutCommand({ TableName: TABLE, Item: entry }));
}

async function getAllEvents() {
  // Fine for a demo/audit-trail volume. At real scale, page with
  // ExclusiveStartKey or query a GSI on a coarse date partition instead
  // of a full table scan.
  const res = await doc.send(new ScanCommand({ TableName: TABLE }));
  const items = res.Items || [];
  return items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

async function healthCheck() {
  try {
    await doc.send(new ScanCommand({ TableName: TABLE, Limit: 1 }));
    return { ok: true, backend: 'dynamodb', table: TABLE, region: REGION };
  } catch (err) {
    return { ok: false, backend: 'dynamodb', table: TABLE, error: err.message };
  }
}

module.exports = { recordEvent, getAllEvents, healthCheck };
