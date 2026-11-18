process.env.MAX_VOICE_FAILS = '3';   // lockout is off by default; this test file covers the opt-in lockout
// End-to-end flow test using node:test. Run: npm test
process.env.STORE_FILE = require('path').join(require('os').tmpdir(), `vba-test-${Date.now()}.json`);
process.env.SESSION_SECRET = 'test';
const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert/strict');
const app = require('../server');
const { wavB64 } = require('./synth');

let base, cookie = '';
let server;
before(() => new Promise(r => { server = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => server.close());

async function call(method, url, body) {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
}
const say = async (spk, seed, ch, transcript) => (await call('POST', '/voice/verify', { audio: wavB64(spk, seed), transcript: transcript ?? ch.phrase })).json;
const ask = async msg => (await call('POST', '/voice', { message: msg, lang: 'en' })).json;

test('API requires login (no username-in-URL access)', async () => {
    assert.equal((await call('GET', '/transactions')).status, 401);
    assert.equal((await call('GET', '/user/ayush')).status, 404);
});
test('wrong password rejected, right one accepted', async () => {
    assert.equal((await call('POST', '/login', { username: 'ayush', password: 'nope' })).json.success, false);
    const r = (await call('POST', '/login', { username: 'ayush', password: '1234' })).json;
    assert.equal(r.success, true); assert.equal(r.user.voiceEnrolled, false); assert.equal(r.user.passwordHash, undefined);
});
test('level 0/1 commands need no voice check', async () => {
    assert.match((await ask('hello')).reply, /Hello Ayush/);
    assert.match((await ask('bank timing')).reply, /Branch hours/);
});
test('sensitive command before enrollment asks to enroll', async () => {
    assert.equal((await ask('what is my balance')).needsEnrollment, true);
});
test('enrollment builds a profile', async () => {
    await call('POST', '/voice/enroll/start');
    for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/voice/enroll/sample', { audio: wavB64('owner', 100 + i) })).json.success, true);
    assert.equal((await call('POST', '/voice/enroll/finish')).json.success, true);
});
test('balance: owner voice + correct challenge -> allowed', async () => {
    const r = await ask('what is my balance');
    assert.equal(r.needsVerification, true); assert.equal(r.level, 2);
    const v = await say('owner', 201, r.challenge);
    assert.equal(v.success, true); assert.match(v.reply, /9,80,000/);
});
test('no standing voice window: every sensitive command needs its own voice check', async () => {
    const r = await ask('show my account');
    assert.equal(r.needsVerification, true);
    assert.equal(r.reply.includes('XXXXXX6789'), false);
});
test('replay: the same recording submitted again is blocked even with a new challenge', async () => {
    let r = await ask('what is my balance');
    assert.equal((await say('owner', 610, r.challenge)).success, true);
    r = await ask('what is my balance');
    const again = await say('owner', 610, r.challenge);            // byte-identical audio
    assert.equal(again.success, false);
    assert.equal(again.replay, true);
});
test('a voice check done for a command cannot be reused for a payment or for re-enrollment', async () => {
    const r = await ask('what is my balance');
    assert.equal((await say('owner', 205, r.challenge)).success, true);
    const pay = { amount: 5, payee: 'Z', mode: 'upi', upiId: 'z@vaanibank' };
    assert.equal((await call('POST', '/payment/initiate', pay)).json.needsVerification, true);
    assert.equal((await call('POST', '/voice/enroll/start')).json.needsVerification, true);
});
test('non-owner voice with correct phrase -> denied, and no data leaked', async () => {
    app.locals.voiceFails.clear(); cookie = ''; await call('POST', '/login', { username: 'ayush', password: '1234' });
    const r = await ask('balance');
    const v = await say('other1', 301, r.challenge);
    assert.equal(v.success, false); assert.doesNotMatch(JSON.stringify(v), /9,80,000|score/);
});
test('owner voice but WRONG phrase (replay of an old recording) -> denied', async () => {
    app.locals.voiceFails.clear(); cookie = ''; await call('POST', '/login', { username: 'ayush', password: '1234' });
    const r = await ask('balance');
    const wrong = r.challenge.phrase.startsWith('9') ? '11 red' : '99 black';
    assert.equal((await say('owner', 202, r.challenge, wrong)).success, false);
});
test('a challenge is single use', async () => {
    app.locals.voiceFails.clear(); cookie = ''; await call('POST', '/login', { username: 'ayush', password: '1234' });
    const r = await ask('balance');
    await say('owner', 203, r.challenge, 'wrong words');           // burns the challenge
    assert.equal((await say('owner', 204, r.challenge)).expired, true);
});
test('three failures lock voice verification', async () => {
    app.locals.voiceFails.clear(); cookie = ''; await call('POST', '/login', { username: 'ayush', password: '1234' });
    let last;
    for (let i = 0; i < 3; i++) { const r = await ask('balance'); if (r.locked) { last = r; break; } last = await say('other1', 400 + i, r.challenge); }
    assert.equal(last.locked, true);
});

test('transfer: needs voice, then OTP; wrong OTP fails; right OTP pays', async () => {
    // fresh user session for a different account (ashish) so the lock above does not interfere
    cookie = ''; await call('POST', '/login', { username: 'ashish2604', password: 'ashish2604' });
    const pay = { amount: 1500, payee: 'Ravi', mode: 'upi', upiId: 'ravi@vaanibank' };
    assert.equal((await call('POST', '/payment/initiate', pay)).json.needsEnrollment, true);
    await call('POST', '/voice/enroll/start');
    // ashish enrolls with a different synthetic speaker
    for (let i = 0; i < 5; i++) await call('POST', '/voice/enroll/sample', { audio: wavB64('other2', 500 + i) });
    assert.equal((await call('POST', '/voice/enroll/finish')).json.success, true);

    let r = (await call('POST', '/payment/initiate', pay)).json;
    assert.equal(r.needsVerification, true);
    assert.equal((await say('other2', 510, r.challenge)).success, true);
    r = (await call('POST', '/payment/initiate', pay)).json;
    assert.equal(r.stage, 'otp'); assert.match(r.demoOtp, /^\d{6}$/);
    const bad = (await call('POST', '/payment/confirm', { code: r.demoOtp === '000000' ? '111111' : '000000' })).json;
    assert.equal(bad.success, false);
    const ok = (await call('POST', '/payment/confirm', { code: r.demoOtp })).json;
    assert.equal(ok.success, true); assert.equal(ok.newBalance, 1000000 - 1500);
    // receipt works, and a second transfer needs a fresh voice check
    assert.equal((await fetch(`${base}/transaction/${ok.transaction.id}/receipt`, { headers: { cookie } })).headers.get('content-type'), 'application/pdf');
    assert.equal((await call('POST', '/payment/initiate', pay)).json.needsVerification, true);
});
test('PIN works as the second factor', async () => {
    // Start a fresh session so the preceding transfer test's voice-auth window cannot leak in.
    cookie = ''; await call('POST', '/login', { username: 'ashish2604', password: 'ashish2604' });
    const pay = { amount: 10, payee: 'Sam', mode: 'neft', account: '123456789012', ifsc: 'VANN0001234' };
    let r = (await call('POST', '/payment/initiate', pay)).json;
    await say('other2', 520, r.challenge);
    await call('POST', '/payment/initiate', pay);
    assert.equal((await call('POST', '/payment/confirm', { method: 'pin', code: '5678' })).json.success, true);
});
test('input validation + limits', async () => {
    for (const bad of [{ amount: -5 }, { amount: 'abc' }, { amount: 999999 }, { amount: 10, payee: 'x', mode: 'upi', upiId: 'bad' }])
        assert.equal((await call('POST', '/payment/initiate', { payee: 'x', mode: 'upi', upiId: 'a@b', ...bad })).json.success, false);
});
