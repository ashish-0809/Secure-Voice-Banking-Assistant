// Spoken/written assistant replies. Missing keys fall back to English.
const LANGS = ['en', 'hi', 'ta', 'te', 'bn'];
const M = {
  greeting: { en: 'Hello {name}! How can I help you today?', hi: 'नमस्ते {name}! मैं आपकी कैसे मदद कर सकता हूँ?', ta: 'வணக்கம் {name}! நான் உங்களுக்கு எப்படி உதவலாம்?', te: 'నమస్కారం {name}! నేను మీకు ఎలా సహాయం చేయగలను?', bn: 'নমস্কার {name}! আমি কীভাবে সাহায্য করতে পারি?' },
  help: { en: 'You can ask for your balance, account details, recent transactions, a statement, or say "transfer money". Sensitive requests need your voice to be verified.', hi: 'आप बैलेंस, खाता विवरण, हालिया लेनदेन, स्टेटमेंट या पैसे ट्रांसफर के बारे में पूछ सकते हैं। संवेदनशील अनुरोधों के लिए आपकी आवाज़ सत्यापित की जाएगी।', ta: 'இருப்பு, கணக்கு விவரம், சமீபத்திய பரிவர்த்தனைகள், அறிக்கை அல்லது பணப் பரிமாற்றம் பற்றி கேட்கலாம். முக்கியமான கோரிக்கைகளுக்கு உங்கள் குரல் சரிபார்க்கப்படும்.', te: 'బ్యాలెన్స్, ఖాతా వివరాలు, ఇటీవలి లావాదేవీలు, స్టేట్‌మెంట్ లేదా డబ్బు బదిలీ గురించి అడగవచ్చు. సున్నితమైన అభ్యర్థనలకు మీ గొంతు ధృవీకరించబడుతుంది.', bn: 'আপনি ব্যালান্স, অ্যাকাউন্টের বিবরণ, সাম্প্রতিক লেনদেন, স্টেটমেন্ট বা টাকা পাঠানো সম্পর্কে জিজ্ঞাসা করতে পারেন। সংবেদনশীল অনুরোধে আপনার কণ্ঠ যাচাই করা হবে।' },
  unknown: { en: "Sorry, I didn't understand. Please try again.", hi: 'क्षमा करें, मैं समझ नहीं पाया। कृपया फिर से कहें।', ta: 'மன்னிக்கவும், எனக்குப் புரியவில்லை. மீண்டும் முயற்சிக்கவும்.', te: 'క్షమించండి, నాకు అర్థం కాలేదు. దయచేసి మళ్లీ ప్రయత్నించండి.', bn: 'দুঃখিত, বুঝতে পারিনি। আবার চেষ্টা করুন।' },
  info: { en: 'Branch hours (demo information): Monday to Friday 9:30 to 16:30, Saturday 9:30 to 13:30.', hi: 'शाखा का समय (डेमो जानकारी): सोमवार से शुक्रवार 9:30 से 16:30, शनिवार 9:30 से 13:30।' },
  balance: { en: 'Your available balance is ₹{amt}', hi: 'आपका बैलेंस ₹{amt} है', ta: 'உங்கள் இருப்பு ₹{amt}', te: 'మీ బ్యాలెన్స్ ₹{amt}', bn: 'আপনার ব্যালান্স ₹{amt}' },
  account: { en: 'Your account number is {acct}, branch {branch}, IFSC {ifsc}', hi: 'आपका खाता नंबर {acct}, शाखा {branch}, IFSC {ifsc} है', ta: 'உங்கள் கணக்கு எண் {acct}, கிளை {branch}, IFSC {ifsc}', te: 'మీ ఖాతా సంఖ్య {acct}, శాఖ {branch}, IFSC {ifsc}', bn: 'আপনার অ্যাকাউন্ট নম্বর {acct}, শাখা {branch}, IFSC {ifsc}' },
  no_txn: { en: 'No recent transactions found', hi: 'कोई हालिया लेनदेन नहीं', ta: 'சமீபத்திய பரிவர்த்தனைகள் இல்லை', te: 'ఇటీవలి లావాదేవీలు లేవు', bn: 'সাম্প্রতিক কোনো লেনদেন নেই' },
  txns: { en: 'Your last transactions: {list}', hi: 'आपके पिछले लेनदेन: {list}', ta: 'உங்கள் கடைசி பரிவர்த்தனைகள்: {list}', te: 'మీ చివరి లావాదేవీలు: {list}', bn: 'আপনার সর্বশেষ লেনদেন: {list}' },
  rcv: { en: 'Received', hi: 'प्राप्त', ta: 'பெறப்பட்டது', te: 'అందుకున్నారు', bn: 'পেয়েছেন' },
  sent: { en: 'Sent', hi: 'भेजा', ta: 'அனுப்பப்பட்டது', te: 'పంపారు', bn: 'পাঠিয়েছেন' },
  statement: { en: 'Statement: {count} transactions, credits ₹{credits}, debits ₹{debits}', hi: 'स्टेटमेंट: {count} लेनदेन, जमा ₹{credits}, निकासी ₹{debits}', ta: 'அறிக்கை: {count} பரிவர்த்தனைகள், வரவு ₹{credits}, செலவு ₹{debits}', te: 'స్టేట్‌మెంట్: {count} లావాదేవీలు, జమ ₹{credits}, ఖర్చు ₹{debits}', bn: 'স্টেটমেন্ট: {count}টি লেনদেন, জমা ₹{credits}, খরচ ₹{debits}' },
  transfer_open: { en: 'Opening the payment form. Transfers need your voice check and an OTP or PIN.', hi: 'पैसे भेजने के लिए स्क्रीन पर दिए फॉर्म का उपयोग करें। आपकी आवाज़ और OTP सत्यापित किए जाएंगे।', ta: 'பணப் பரிமாற்றத்திற்கு திரையில் உள்ள படிவத்தைப் பயன்படுத்தவும். உங்கள் குரல் மற்றும் OTP சரிபார்க்கப்படும்.', te: 'డబ్బు బదిలీకి స్క్రీన్‌పై ఉన్న ఫారమ్ ఉపయోగించండి. మీ గొంతు మరియు OTP ధృవీకరించబడతాయి.', bn: 'টাকা পাঠাতে স্ক্রিনের ফর্মটি ব্যবহার করুন। আপনার কণ্ঠ ও OTP যাচাই করা হবে।' },
  verify_prompt: { en: 'To verify your voice, please say: "{phrase}"', hi: 'अपनी आवाज़ सत्यापित करने के लिए बोलें: "{phrase}"', ta: 'உங்கள் குரலை சரிபார்க்க "{phrase}" என்று சொல்லுங்கள்', te: 'మీ గొంతును ధృవీకరించడానికి "{phrase}" అని చెప్పండి', bn: 'আপনার কণ্ঠ যাচাই করতে "{phrase}" বলুন' },
  enroll_needed: { en: 'Please enroll your voice first (Voice Security panel).', hi: 'पहले अपनी आवाज़ दर्ज करें।', ta: 'முதலில் உங்கள் குரலைப் பதிவு செய்யவும்.', te: 'ముందుగా మీ గొంతును నమోదు చేయండి.', bn: 'প্রথমে আপনার কণ্ঠ নথিভুক্ত করুন।' },
  verify_failed: { en: 'Voice verification failed. Access denied.', hi: 'आवाज़ सत्यापन विफल रहा। पहुँच अस्वीकृत।', ta: 'குரல் சரிபார்ப்பு தோல்வியடைந்தது. அணுகல் மறுக்கப்பட்டது.', te: 'గొంతు ధృవీకరణ విఫలమైంది. యాక్సెస్ నిరాకరించబడింది.', bn: 'কণ্ঠ যাচাই ব্যর্থ হয়েছে। প্রবেশ অস্বীকৃত।' },
  locked: { en: 'Too many failed attempts. Voice verification is locked for a few minutes.', hi: 'बहुत अधिक विफल प्रयास। आवाज़ सत्यापन कुछ समय के लिए बंद है।', ta: 'பல தோல்விகள். குரல் சரிபார்ப்பு தற்காலிகமாக பூட்டப்பட்டுள்ளது.', te: 'చాలా విఫలయత్నాలు. గొంతు ధృవీకరణ తాత్కాలికంగా లాక్ చేయబడింది.', bn: 'অনেকবার ব্যর্থ। কণ্ঠ যাচাই সাময়িকভাবে লক।' },
  challenge_expired: { en: 'The voice challenge expired. Please ask again.', hi: 'चुनौती समाप्त हो गई। कृपया फिर से कहें।', ta: 'சவால் காலாவதியானது. மீண்டும் கேளுங்கள்.', te: 'ఛాలెంజ్ గడువు ముగిసింది. మళ్లీ అడగండి.', bn: 'চ্যালেঞ্জের মেয়াদ শেষ। আবার চেষ্টা করুন।' },
};

const inr = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const pickLang = (...c) => c.find(l => LANGS.includes(l)) || 'en';

function t(lang, key, params = {}) {
    const entry = M[key] || {};
    const s = entry[lang] || entry.en || key;
    return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : ''));
}

module.exports = { t, inr, pickLang, LANGS };
