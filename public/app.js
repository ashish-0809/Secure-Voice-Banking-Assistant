'use strict';
// ===== helpers =====
const $ = id => document.getElementById(id);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const STT_LANG = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN', bn: 'bn-IN' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const inr = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
let user = null, mode = 'upi', micBusy = false;

async function api(method, url, body) {
    let r;
    try {
        r = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
    } catch (e) {
        return { success: false, message: 'Server se connection nahi ho raha. Check karo ki npm start chal raha hai.' };
    }
    const data = await r.json().catch(() => ({}));
    // Do not silently reload the whole app on 401: show the actual session error instead.
    if (r.status === 401) {
        return { ...data, success: false, authRequired: true, message: data.message || 'Session expire ho gaya. Dobara login karo.' };
    }
    if (!r.ok && !data.message) data.message = `Request failed (${r.status})`;
    return data;
}
function el(tag, props = {}, ...kids) {
    const e = Object.assign(document.createElement(tag), props);
    kids.flat().forEach(k => e.append(k));
    return e;
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500); }
const lang = () => $('lang').value;

function addChat(who, text, cls = '') {
    const m = el('div', { className: `msg ${who === 'You' ? 'you' : 'ai'} ${cls}`, textContent: text });  // textContent: no HTML injection
    $('chat').append(m); $('chat').scrollTop = $('chat').scrollHeight;
}
function speak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = STT_LANG[lang()]; speechSynthesis.speak(u);
}
function say(text, cls) { addChat('AI', text, cls); speak(text); }

// ===== modal =====
function openModal(...content) { const b = $('modalBox'); b.replaceChildren(...content); $('modal').hidden = false; }
function closeModal() { $('modal').hidden = true; $('modalBox').replaceChildren(); }

// ===== audio capture -> 16 kHz mono PCM16 WAV (base64) =====
// Mirror of the server's audio checks (speech >= 1 s within 35 dB of the loudest frame, level >= -50 dBFS), so a bad
// recording is caught BEFORE it uses up a verification attempt.
function analyzePcm(pcm) {
    const fl = 400, hop = 160, db = [];
    for (let i = 0; i + fl <= pcm.length; i += hop) { let s = 0; for (let j = 0; j < fl; j++) s += pcm[i + j] * pcm[i + j]; db.push(10 * Math.log10(s / fl + 1e-12)); }
    if (!db.length) return { speechSec: 0, rmsDb: -120 };
    let mx = -200; for (const d of db) if (d > mx) mx = d;
    const kept = []; db.forEach((d, k) => { if (d > mx - 35) kept.push(k); });
    let s = 0, n = 0; for (const k of kept) for (let j = 0; j < hop; j++) { const v = pcm[k * hop + j] || 0; s += v * v; n++; }
    return { speechSec: kept.length * hop / 16000, rmsDb: 10 * Math.log10(s / Math.max(1, n) + 1e-12) };
}
const recordingTooWeak = a => a.speechSec < 1.0 || a.rmsDb < -48;

async function toWavBase64(blob) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close();
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    pcm.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true));
    let bin = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: btoa(bin), ...analyzePcm(pcm) };
}

// Record audio; optionally run speech-to-text on the same utterance (challenge phrase check).
async function capture({ stt = false, ms = 4000, onTick, onLevel } = {}) {
    // Raw, unprocessed audio keeps the voice characteristics the verifier relies on.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    const rec = new MediaRecorder(stream), chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const stopped = new Promise(r => (rec.onstop = r));
    let transcript = '', ended;
    if (stt && SR) {
        ended = new Promise(resolve => {
            // continuous + all results/alternatives: a pause between the number and the colour, or a mis-heard first
            // guess, no longer loses the phrase. The phrase is still random and single-use, and the voice must match.
            const r = new SR(); r.lang = 'en-IN'; r.interimResults = true; r.continuous = true; r.maxAlternatives = 3;
            r.onresult = e => { transcript = [...e.results].map(res => [...res].map(a => a.transcript).join(' | ')).join(' | '); };
            r.onerror = resolve; r.onend = resolve;
            // Newer Chrome can recognise from the SAME microphone track we record (no second capture of the mic, which
            // made the recording quiet/choppy on some Windows setups). Older browsers ignore the argument.
            try { r.start(stream.getAudioTracks()[0]); } catch { try { r.start(); } catch { resolve(); } }
            setTimeout(() => { try { r.stop(); } catch {} }, ms);
        });
    }
    rec.start();
    let actx, an, buf;
    if (onLevel) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); an = actx.createAnalyser(); an.fftSize = 1024; buf = new Float32Array(an.fftSize); actx.createMediaStreamSource(stream).connect(an); } catch { actx = null; } }
    const t0 = Date.now(), tick = setInterval(() => {
        onTick && onTick(Math.min(1, (Date.now() - t0) / ms));
        if (actx) { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; onLevel(10 * Math.log10(s / buf.length + 1e-12)); }
    }, 150);
    // Always record the full `ms` (same length as enrollment). Speech recognition can end or fail within a second;
    // stopping then produced clips that were too short to verify.
    if (ended) await Promise.all([Promise.race([ended, sleep(8000)]), sleep(ms)]); else await sleep(ms);
    await sleep(250);
    clearInterval(tick); rec.stop(); await stopped; stream.getTracks().forEach(t => t.stop());
    if (actx) actx.close();
    const w = await toWavBase64(new Blob(chunks, { type: rec.mimeType }));
    return { audio: w.b64, transcript, speechSec: w.speechSec, rmsDb: w.rmsDb };
}
const micError = e => (e && e.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'Could not use the microphone.');

// ===== login / dashboard =====
async function login() {
    $('loginMsg').textContent = '';
    const r = await api('POST', '/login', { username: $('username').value.trim(), password: $('password').value });
    if (!r.success) { $('loginMsg').textContent = r.message || 'Invalid Customer ID or Password'; return; }
    $('password').value = '';
    showDashboard(r.user, r.speaker);
}
function showDashboard(u, spk) {
    user = u;
    $('loginView').hidden = true; $('dash').hidden = false;
    if (u.language && STT_LANG[u.language]) $('lang').value = u.language;
    $('backendNote').textContent = spk?.backend === 'ecapa'
        ? 'Speaker model: ECAPA-TDNN.'
        : 'Verify your voice to help protect access to sensitive banking features';
    renderUser();
    addChat('AI', `Welcome ${u.name}! Try “what is my balance” or “transfer money”.`);
    loadTransactions(); loadLog();
}
function renderUser() {
    $('uName').textContent = user.name; $('uAcct').textContent = user.masked_account; $('uBranch').textContent = user.branch;
    $('uIfsc').textContent = user.ifsc; $('uPhone').textContent = user.masked_phone; $('uBal').textContent = inr(user.balance);
    const b = $('enrollBadge'); b.textContent = user.voiceEnrolled ? 'Voice enrolled' : 'Not enrolled'; b.className = 'badge' + (user.voiceEnrolled ? ' ok' : '');
    $('enrollBtn').textContent = user.voiceEnrolled ? '🎙️ Re-enroll my voice' : '🎙️ Enroll my voice';
    $('removeVoiceBtn').hidden = !user.voiceEnrolled;
}
async function refreshUser() { const r = await api('GET', '/me'); if (r.success) { user = r.user; renderUser(); } }

async function loadTransactions() {
    const r = await api('GET', '/transactions'), box = $('txList');
    box.replaceChildren();
    if (!r.transactions?.length) { box.append(el('p', { className: 'hint', textContent: 'No transactions yet.' })); return; }
    r.transactions.slice(0, 6).forEach(t => {
        const row = el('div', { className: 'tx', onclick: () => showReceipt(t) },
            el('div', {}, el('div', { textContent: t.description || t.payee || 'Transaction' }),
                el('small', { textContent: `${new Date(t.date).toLocaleString('en-IN')} · ${t.mode || ''}` })),
            el('div', { className: `amt ${t.type}`, textContent: `${t.type === 'credit' ? '+' : '−'}₹${inr(t.amount)}` }));
        box.append(row);
    });
}
async function loadLog() {
    const r = await api('GET', '/security/log'), ul = $('logList');
    ul.replaceChildren();
    const names = { login: 'Login', enroll: 'Voice enrollment', voice_verify: 'Voice verification', otp_sent: 'OTP sent', payment: 'Payment', payment_code: 'OTP/PIN check', payment_blocked: 'Payment blocked', profile_deleted: 'Voice profile removed' };
    (r.events || []).forEach(e => {
        const label = names[e.event] || (e.event.startsWith('command:') ? 'Voice command' : e.event);
        ul.append(el('li', {}, el('span', { textContent: `${label} ` }), el('span', { className: e.ok ? 'good' : 'bad', textContent: `${e.ok ? '✓' : '✗'} ${new Date(e.ts).toLocaleTimeString('en-IN')}` })));
    });
}

// ===== voice commands =====
async function handleResponse(d) {
    if (d.reply) say(d.reply, d.success === false || d.locked ? 'deny' : d.success ? 'ok' : '');
    if (d.action === 'open_payment') openPayment();
    if (d.needsEnrollment) $('voiceCard').scrollIntoView({ behavior: 'smooth' });
    if (d.needsVerification) await handleResponse(await verifyVoice(d.challenge));
    loadLog(); refreshUser();
}
async function sendCommand(text) {
    text = text.trim(); if (!text) return;
    addChat('You', text);
    await handleResponse(await api('POST', '/voice', { message: text, lang: lang() }));
}
async function listen() {
    if (!SR) { toast('Speech recognition needs Chrome or Edge. You can type a command instead.'); return; }
    if (micBusy) return;
    micBusy = true; $('micBtn').textContent = '⏺️ Listening…'; $('micBtn').disabled = true;
    const r = new SR(); r.lang = STT_LANG[lang()]; r.interimResults = false;
    const done = () => { micBusy = false; $('micBtn').textContent = '🎤 Ask by voice'; $('micBtn').disabled = false; };
    r.onresult = e => sendCommand(e.results[0][0].transcript);
    r.onerror = () => { addChat('AI', "Sorry, I couldn't hear you. Please try again."); done(); };
    r.onend = done;
    try { r.start(); } catch { done(); }
}

// ===== owner-voice verification with a random challenge =====
async function verifyVoice(challenge) {
    const status = el('p', { textContent: 'Get ready…' }), bar = el('i'), pulse = el('div', { className: 'pulse' }), lvl = el('small', { textContent: '' });
    openModal(el('h3', { textContent: 'Verify your voice' }), el('p', { textContent: 'Say this phrase clearly:' }),
        el('div', { className: 'phrase', textContent: challenge.phrase }), pulse, el('div', { className: 'bar' }, bar), status, lvl);
    try {
        await sleep(600);
        let cap = null;
        for (let attempt = 1; attempt <= 3; attempt++) {         // a too quiet / too short recording is retried for free
            status.textContent = '🎙️ Listening… speak now';
            cap = await capture({ stt: true, ms: 4500, onTick: p => (bar.style.width = `${p * 100}%`),
                onLevel: db => { lvl.textContent = `Mic level: ${db < -55 ? 'very low' : db < -42 ? 'low' : 'good'} (${Math.round(db)} dB)`; } });
            if (!recordingTooWeak(cap)) break;
            const msg = `Too quiet or too short (${cap.speechSec.toFixed(1)} s of speech, ${Math.round(cap.rmsDb)} dB).`;
            if (attempt === 3) {
                closeModal();
                return { success: false, quality: true, reply: `${msg} Raise the microphone volume in Windows Sound settings (Input), sit closer, and try again.` };
            }
            status.textContent = `⚠️ ${msg} Move closer - trying again…`; bar.style.width = '0';
            await sleep(1800);
        }
        pulse.hidden = true; status.textContent = 'Verifying…';
        const res = await api('POST', '/voice/verify', { audio: cap.audio, transcript: cap.transcript, lang: lang() });
        status.textContent = res.success ? '✅ Voice verified' : '❌ Verification failed';
        if (res.debug) status.textContent += `  [score ${res.debug.score} / needs ${res.debug.threshold}, phrase ${res.debug.phrase ? 'ok' : 'WRONG'} (said "${res.debug.expected}", heard "${res.debug.heard}"), recorded ${cap.speechSec.toFixed(1)} s at ${Math.round(cap.rmsDb)} dB${res.debug.err ? ', ' + res.debug.err : ''}]`;
        await sleep(res.success ? 700 : (res.debug ? 6000 : 1400)); closeModal();
        return res;
    } catch (e) {
        closeModal();
        return { success: false, reply: micError(e) };
    }
}

function askPassword(text) {
    return new Promise(resolve => {
        const pw = el('input', { type: 'password', placeholder: 'Account password', autocomplete: 'current-password' });
        const ok = el('button', { className: 'btn', textContent: 'Continue' }), no = el('button', { className: 'btn ghost', textContent: 'Cancel' });
        ok.onclick = () => { closeModal(); resolve(pw.value); };
        no.onclick = () => { closeModal(); resolve(null); };
        openModal(el('h3', { textContent: 'Confirm it is you' }), el('p', { textContent: text }), pw, el('div', { className: 'row' }, ok, no));
        pw.focus();
    });
}

// ===== enrollment =====
async function enroll() {
    let s = await api('POST', '/voice/enroll/start');
    if (s.needsPassword) {                                       // old profile from another speaker backend: cannot verify by voice
        const pw = await askPassword('Your old voice profile cannot be verified with the current speaker model. Enter your account password to create a new one.');
        if (pw === null) return;
        s = await api('POST', '/voice/enroll/start', { password: pw });
        if (s.needsPassword) { toast(s.message); return; }
    }
    if (s.needsVerification) {                                   // replacing an existing profile needs the owner's voice
        say('To replace your voice profile, first verify your current voice.');
        const v = await verifyVoice(s.challenge);
        loadLog();
        if (!v.success) { say(v.reply || 'Verification failed. Voice profile not changed.', 'deny'); return; }
        s = await api('POST', '/voice/enroll/start');
    }
    if (!s.success) {
        toast(s.message || 'Voice enrollment start nahi ho saka.');
        if (s.authRequired) { $('loginView').hidden = false; $('dash').hidden = true; user = null; }
        return;
    }
    let count = 0;
    const title = el('h3', { textContent: 'Enroll your voice' });
    const info = el('p', { className: 'small', textContent: `Record ${s.min}–${s.max} samples in a quiet place, in your normal voice. Read each phrase aloud.` });
    const phrase = el('div', { className: 'phrase' }), bar = el('i'), msg = el('p', { className: 'small' });
    const recBtn = el('button', { className: 'btn', textContent: '⏺️ Record' });
    const doneBtn = el('button', { className: 'btn secondary', textContent: 'Finish', disabled: true });
    const cancel = el('button', { className: 'btn ghost', textContent: 'Cancel', onclick: closeModal });
    const refresh = () => { phrase.textContent = s.phrases[count] || ''; msg.textContent = `Samples recorded: ${count} / ${s.max}`; recBtn.disabled = count >= s.max; doneBtn.disabled = count < s.min; };
    recBtn.onclick = async () => {
        recBtn.disabled = doneBtn.disabled = true; msg.textContent = '🎙️ Recording…';
        try {
            const { audio } = await capture({ ms: 4000, onTick: p => (bar.style.width = `${p * 100}%`) });
            const r = await api('POST', '/voice/enroll/sample', { audio });
            if (r.success) count = r.count; else toast(r.message);
        } catch (e) { toast(micError(e)); }
        bar.style.width = '0'; refresh();
    };
    doneBtn.onclick = async () => {
        const r = await api('POST', '/voice/enroll/finish');
        closeModal();
        if (r.success) { user = r.user; renderUser(); say('Voice enrolled. Sensitive requests are now protected by your voice.', 'ok'); loadLog(); }
        else say(r.message, 'deny');
    };
    openModal(title, info, phrase, el('div', { className: 'bar' }, bar), msg, recBtn, doneBtn, cancel);
    refresh();
}
async function removeVoice() {
    let r = await api('DELETE', '/voice/profile');
    if (r.needsPassword) {
        const pw = await askPassword('Enter your account password to remove the old voice profile.');
        if (pw === null) return;
        r = await api('DELETE', '/voice/profile', { password: pw });
        if (r.needsPassword) { toast(r.message); return; }
    }
    if (r.authRequired) { toast(r.message); $('loginView').hidden = false; $('dash').hidden = true; user = null; return; }
    if (!r.success && !r.needsVerification) { toast(r.message || 'Voice profile remove nahi ho saka.'); return; }
    if (r.needsVerification) { const v = await verifyVoice(r.challenge); if (!v.success) { say(v.reply || 'Verification failed.', 'deny'); return; } r = await api('DELETE', '/voice/profile'); }
    if (r.success) { await refreshUser(); say('Voice profile removed.'); loadLog(); }
}

// ===== payments: owner voice -> OTP / PIN =====
function openPayment() { $('payCard').hidden = false; $('payCard').scrollIntoView({ behavior: 'smooth' }); }
function setMode(m) {
    mode = m;
    document.querySelectorAll('.mode').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    $('pUpi').hidden = m !== 'upi'; $('pAcct').hidden = $('pIfsc').hidden = m === 'upi';
}
function paymentBody() {
    return { amount: $('pAmount').value, payee: $('pPayee').value, mode, upiId: $('pUpi').value, account: $('pAcct').value, ifsc: $('pIfsc').value, description: $('pDesc').value };
}
async function startPayment() {
    const body = paymentBody();
    let r = await api('POST', '/payment/initiate', body);
    if (r.needsEnrollment) { say(r.message, 'deny'); $('voiceCard').scrollIntoView({ behavior: 'smooth' }); return; }
    if (r.needsVerification) {
        say('For your safety, please verify your voice before this transfer.');
        const v = await verifyVoice(r.challenge);
        loadLog();
        if (!v.success) { say(v.reply || 'Voice verification failed. Payment not started.', 'deny'); return; }
        r = await api('POST', '/payment/initiate', body);
    }
    if (r.stage === 'otp') otpModal(r); else { toast(r.message || 'Could not start payment'); if (r.message) say(r.message, 'deny'); }
}
function otpModal(info) {
    let method = 'otp', left = info.expiresInSec;
    const code = el('input', { className: 'otp', inputMode: 'numeric', maxLength: 6, placeholder: '••••••', autocomplete: 'one-time-code' });
    const sub = el('p', { className: 'small', textContent: `OTP sent to ${info.maskedPhone}` });
    const timer = el('p', { className: 'small' }), err = el('p', { className: 'error' });
    const swap = el('button', { className: 'btn ghost', textContent: 'Use PIN instead' });
    const ok = el('button', { className: 'btn', textContent: 'Confirm payment' });
    const cancel = el('button', { className: 'btn ghost', textContent: 'Cancel', onclick: () => { clearInterval(iv); api('POST', '/payment/cancel'); closeModal(); } });
    const iv = setInterval(() => { left--; timer.textContent = `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; if (left <= 0) { clearInterval(iv); err.textContent = 'Expired - start again.'; ok.disabled = true; } }, 1000);
    timer.textContent = `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    swap.onclick = () => { method = method === 'otp' ? 'pin' : 'otp'; swap.textContent = method === 'otp' ? 'Use PIN instead' : 'Use OTP instead'; code.maxLength = method === 'pin' ? 8 : 6; code.value = ''; sub.textContent = method === 'pin' ? 'Enter your transaction PIN' : `OTP sent to ${info.maskedPhone}`; };
    ok.onclick = async () => {
        err.textContent = ''; ok.disabled = true;
        const r = await api('POST', '/payment/confirm', { code: code.value, method });
        ok.disabled = false;
        if (!r.success) { err.textContent = r.message; if (/expired|Too many|Insufficient/.test(r.message || '')) { clearInterval(iv); } return; }
        clearInterval(iv); closeModal();
        user.balance = r.newBalance; renderUser();
        ['pAmount', 'pPayee', 'pUpi', 'pAcct', 'pIfsc', 'pDesc'].forEach(i => ($(i).value = ''));
        $('payCard').hidden = true;
        say(`Payment of ₹${inr(r.transaction.amount)} to ${r.transaction.payee} successful. New balance ₹${inr(r.newBalance)}.`, 'ok');
        loadTransactions(); loadLog(); showReceipt(r.transaction);
    };
    const demo = info.demoOtp ? el('div', { className: 'demo', textContent: `Demo mode (no SMS gateway): your OTP is ${info.demoOtp}` }) : '';
    openModal(el('h3', { textContent: '🔐 Confirm transfer' }), sub, demo, code, timer, err, ok, swap, cancel);
    code.focus();
}

// ===== receipts =====
function showReceipt(t) {
    const rows = [['Transaction ID', t.id], ['Date', new Date(t.date).toLocaleString('en-IN')], ['Amount', `₹${inr(t.amount)}`],
        ['Type', t.type], ['Mode', t.mode || '-'], ['To', t.payee || '-'], ['Status', t.status], ['Description', t.description || '-']];
    openModal(el('h3', { textContent: '🧾 Receipt' }), el('div', { className: 'receipt' }, rows.map(([k, v]) => el('p', {}, el('b', { textContent: k }), document.createTextNode(v)))),
        el('button', { className: 'btn', textContent: '📥 Download PDF', onclick: () => downloadReceipt(t.id) }), el('button', { className: 'btn ghost', textContent: 'Close', onclick: closeModal }));
}
async function downloadReceipt(id) {
    const r = await fetch(`/transaction/${encodeURIComponent(id)}/receipt`);
    if (!r.ok) { toast('Could not download receipt'); return; }
    const a = el('a', { href: URL.createObjectURL(await r.blob()), download: `receipt-${id}.pdf` });
    a.click(); URL.revokeObjectURL(a.href);
}

// ===== wiring =====
$('loginBtn').onclick = login;
['username', 'password'].forEach(i => $(i).addEventListener('keydown', e => e.key === 'Enter' && login()));
$('logoutBtn').onclick = async () => { await api('POST', '/logout'); location.reload(); };
$('micBtn').onclick = listen;
$('sendBtn').onclick = () => { sendCommand($('cmdText').value); $('cmdText').value = ''; };
$('cmdText').addEventListener('keydown', e => { if (e.key === 'Enter') { sendCommand($('cmdText').value); $('cmdText').value = ''; } });
$('enrollBtn').onclick = enroll;
$('removeVoiceBtn').onclick = removeVoice;
$('payToggle').onclick = () => ($('payCard').hidden ? openPayment() : ($('payCard').hidden = true));
$('payBtn').onclick = startPayment;
document.querySelectorAll('.mode').forEach(b => (b.onclick = () => setMode(b.dataset.mode)));
$('modal').addEventListener('click', e => { if (e.target === $('modal') && $('modalBox').querySelector('.pulse') == null) closeModal(); });
setMode('upi');
api('GET', '/me').then(r => { if (r.success) showDashboard(r.user, r.speaker); });  // resume an existing session
