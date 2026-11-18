// Prints the last voice verification / enrollment audit entries (local debugging only).
// Usage: node scripts/last_verify.js
const fs = require('fs'), path = require('path');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'store.json'), 'utf8'));
const rows = (db.audit || []).filter(e => /voice_verify|enroll/.test(e.event)).slice(-10);
if (!rows.length) console.log('No voice entries yet.');
for (const e of rows) console.log(e.ts, e.event, e.ok ? 'OK ' : 'FAIL', e.detail || '');
