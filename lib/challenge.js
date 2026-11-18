// Random voice challenge ("Say 47 Blue") - defends against replayed recordings.
// A challenge is single-use and short-lived; the phrase is unpredictable, so a recording
// of the owner saying something else cannot satisfy it.
const crypto = require('crypto');
// Common, clearly pronounced words that browser speech recognition rarely mishears ("purple"/"orange" were dropped).
const COLORS = ['blue', 'red', 'green', 'yellow', 'white', 'black', 'pink', 'brown'];
const TTL_MS = 45000;

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
    'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const WORD = Object.fromEntries(ONES.map((w, i) => [w, i]));

function randomPhrase() {
    return { digits: String(crypto.randomInt(10, 100)), color: COLORS[crypto.randomInt(COLORS.length)] };
}

function create(session) {
    session.challenge = { ...randomPhrase(), id: crypto.randomUUID(), exp: Date.now() + TTL_MS, used: false };
    return session.challenge;
}

const text = c => `${c.digits} ${c.color}`;

// "forty seven" / "47" / "four seven" / "4 7"  ->  "47"
function spokenDigits(transcript) {
    const toks = String(transcript || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
    let out = '';
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (/^\d+$/.test(t)) out += t;
        else if (TENS[t]) {
            const nx = WORD[toks[i + 1]];
            if (nx >= 1 && nx <= 9) { out += String(TENS[t] + nx); i++; } else out += String(TENS[t]);
        } else if (t in WORD) out += String(WORD[t]);
    }
    return out;
}

function validate(c, transcript) {
    const words = String(transcript || '').toLowerCase().split(/[^a-z]+/);
    const digitsOk = spokenDigits(transcript).includes(c.digits);
    const colorOk = words.includes(c.color);
    return { ok: digitsOk && colorOk, digitsOk, colorOk };
}

module.exports = { create, validate, randomPhrase, text, spokenDigits, TTL_MS };
