/**
 * File-backed audit store.
 *
 * Good for local development and single-instance/single-container
 * deployments. NOT safe as the audit backend for a horizontally-scaled
 * deployment (multiple ECS tasks / Lambda concurrency) because each
 * instance has its own filesystem — use the DynamoDB store for that
 * (set AUDIT_STORE=dynamodb).
 *
 * Concurrency note: a naive "read whole file, push, write whole file"
 * pattern loses events when two requests land at nearly the same time
 * (classic read-modify-write race). We serialize writes through an
 * in-process promise chain so concurrent requests to the SAME process
 * never clobber each other. That does not extend across processes/
 * containers — see the DynamoDB store for that guarantee.
 */

const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.AUDIT_LOG_PATH || path.join(__dirname, '../../../audit-log.json');

let writeChain = Promise.resolve();

function readAllSync() {
  if (!fs.existsSync(DB_FILE)) return [];
  const raw = fs.readFileSync(DB_FILE, 'utf8').trim();
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAllSync(events) {
  // Write to a temp file then rename — avoids a half-written file if the
  // process is killed mid-write (e.g. ECS sending SIGKILL after a timeout).
  const tmp = `${DB_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(events, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

async function recordEvent(entry) {
  // Chain onto the previous write so two near-simultaneous requests
  // can't both read the same "before" state and overwrite each other.
  writeChain = writeChain.then(() => {
    const events = readAllSync();
    events.unshift(entry);
    writeAllSync(events);
  });
  return writeChain;
}

async function getAllEvents() {
  return readAllSync();
}

async function healthCheck() {
  try {
    const dir = path.dirname(DB_FILE);
    fs.accessSync(dir, fs.constants.W_OK);
    return { ok: true, backend: 'file', path: DB_FILE, note: 'not safe for multi-instance deployments' };
  } catch (err) {
    return { ok: false, backend: 'file', error: err.message };
  }
}

module.exports = { recordEvent, getAllEvents, healthCheck };
