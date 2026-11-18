// Sensitivity-based security: higher risk -> stronger authentication.
//   0 NONE  : greeting / help                 -> no verification
//   1 BASIC : general bank information        -> logged-in session only
//   2 OWNER : balance, transactions, account, statement -> owner-voice verification
//   3 STRONG: money transfer                  -> owner voice + OTP/PIN
const LEVEL = { NONE: 0, BASIC: 1, OWNER: 2, STRONG: 3 };

// Order matters: first match wins.
const INTENTS = [
    { name: 'transfer', level: LEVEL.STRONG, kw: ['transfer', 'send money', 'pay', 'payment', 'ट्रांसफर', 'भेज', 'भुगतान', 'पेमेंट',
        'பணம் அனுப்ப', 'பணம் செலுத்த', 'பரிமாற்ற', 'డబ్బు పంప', 'చెల్లింప', 'బదిలీ', 'টাকা পাঠা', 'পেমেন্ট', 'ট্রান্সফার'] },
    { name: 'statement', level: LEVEL.OWNER, kw: ['statement', 'स्टेटमेंट', 'विवरण', 'அறிக்கை', 'స్టేట్‌మెంట్', 'স্টেটমেন্ট'] },
    { name: 'transactions', level: LEVEL.OWNER, kw: ['transaction', 'history', 'लेनदेन', 'इतिहास', 'பரிவர்த்தனை', 'లావాదేవీ', 'লেনদেন'] },
    { name: 'balance', level: LEVEL.OWNER, kw: ['balance', 'how much money', 'बैलेंस', 'शेष', 'पैसा', 'இருப்பு', 'బ్యాలెన్స్', 'నిల్వ', 'ব্যালান্স', 'ব্যালেন্স'] },
    { name: 'account', level: LEVEL.OWNER, kw: ['account', 'ifsc', 'branch', 'खाता', 'खाते', 'அக்கவுண்ட்', 'கணக்கு', 'ఖాతా', 'অ্যাকাউন্ট', 'একাউন্ট'] },
    { name: 'help', level: LEVEL.NONE, kw: ['help', 'what can you do', 'मदद', 'உதவி', 'సహాయం', 'সাহায্য'] },
    { name: 'greeting', level: LEVEL.NONE, kw: ['hello', 'hi', 'hey', 'namaste', 'नमस्ते', 'वणक्कम', 'வணக்கம்', 'నమస్కారం', 'নমস্কার'] },
    { name: 'info', level: LEVEL.BASIC, kw: ['interest rate', 'timing', 'working hours', 'opening hours', 'ब्याज', 'समय'] },
];

const compiled = INTENTS.map(i => ({
    ...i, res: i.kw.map(k => (/^[a-z ]+$/i.test(k) ? new RegExp(k.length <= 3 ? `\\b${k}\\b` : `\\b${k}`, 'i') : new RegExp(k, 'i'))),
}));

function detect(message) {
    const m = String(message || '').toLowerCase();
    const hit = compiled.find(i => i.res.some(r => r.test(m)));
    return hit ? { intent: hit.name, level: hit.level } : { intent: 'unknown', level: LEVEL.NONE };
}

module.exports = { LEVEL, detect };
