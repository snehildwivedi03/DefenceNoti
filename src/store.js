'use strict';

const fs = require('fs');
const path = require('path');
const { PRUNE_DAYS } = require('./config');

const FILE = path.join(__dirname, '..', 'public', 'data', 'notifications.json');

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data.records) data.records = {};
    return data;
  } catch {
    return { updatedAt: null, records: {} };
  }
}

function save(data) {
  data.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// Delete records not seen in the last PRUNE_DAYS days -> nothing kept permanently.
function prune(data) {
  const cutoff = Date.now() - PRUNE_DAYS * 86400000;
  let removed = 0;
  for (const [key, rec] of Object.entries(data.records)) {
    if (!rec.lastSeen || new Date(rec.lastSeen).getTime() < cutoff) {
      delete data.records[key];
      removed++;
    }
  }
  if (removed) console.log(`Pruned ${removed} record(s) older than ${PRUNE_DAYS} days.`);
  return data;
}

module.exports = { load, save, prune, FILE };
