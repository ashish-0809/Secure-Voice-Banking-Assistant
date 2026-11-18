// Tiny JSON-file persistence (users, transactions, voice profiles, audit log).
const fs = require('fs');
const path = require('path');
const FILE = process.env.STORE_FILE || path.join(__dirname, '..', 'data', 'store.json');

function load(seedFn) {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
    catch { const db = seedFn(); save(db); return db; }
}

function save(db) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);
}

module.exports = { load, save };
