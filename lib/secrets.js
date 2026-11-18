// Password / PIN hashing with Node's built-in scrypt (no native deps).
const crypto = require('crypto');

function hashSecret(secret) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(secret), salt, 32);
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifySecret(secret, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [saltHex, hashHex] = stored.split(':');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(secret), Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashSecret, verifySecret };
