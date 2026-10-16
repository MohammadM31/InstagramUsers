// Roadmap O.3 brand voice: validators, template summary, prompt builders (incl. the "no voice = old prompts" guard), handlers with an in-memory fake q, and the LLM call.
// The real SQL is exercised separately against Postgres (docs/AI_PROGRESS.md); here the fake q only has to be as strict as the handlers' own logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBrandVoice, validateVoice, templateSummary, voiceInstruction, captionPrompt, hashtagPrompt, llmSummary, merge, chipCount,
  TONE_TAGS, FORMALITY, LENGTHS, EMOJI, HASHTAG_STYLES, SAMPLE_KINDS, VOICE_FIELDS, MAX_SAMPLES, LLM_REASONS } from '../src/brandvoice.js';

const res = () => { const r = { code: 200, body: undefined }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
const call = async (h, uid, body, params = {}) => { const r = res(); await h({ uid, body, params }, r); return r; };
const A = 'user-a', B = 'user-b';

function fakeQ({ posts = {}, failInsertOnce = false } = {}) {
  const voices = [], samples = [], sqls = []; let sid = 0, fails = failInsertOnce;
  const mine = (rows, uid) => rows.filter(r => r.user_id === uid);
  const shapeV = r => { const { user_id, id, ...o } = r; return { ...o, do: r.dos, dont: r.donts }; };
  const q = async (sql, p = []) => {
    sqls.push({ sql, p });
    if (/^\s*SELECT version,tone_tags/.test(sql)) { const v = mine(voices, p[0]).sort((a, b) => b.version - a.version)[0]; return v ? [shapeV(v)] : []; }
    if (/^\s*SELECT version,source,created_at/.test(sql)) return mine(voices, p[0]).sort((a, b) => b.version - a.version).map(v => ({ version: v.version, source: v.source, created_at: v.created_at }));
    if (/^\s*SELECT id,kind,text/.test(sql)) return mine(samples, p[0]).map(({ user_id, ...o }) => o);
    if (/^\s*INSERT INTO brand_voice/.test(sql)) {
      if (fails) { fails = false; throw Object.assign(new Error('duplicate key'), { code: '23505' }); }
      const [uid, tone_tags, formality, length_pref, emoji_use, hashtag_style, dos, donts, phrases, summary, source] = p;
      const row = { user_id: uid, version: Math.max(0, ...mine(voices, uid).map(v => v.version)) + 1, tone_tags, formality, length_pref, emoji_use, hashtag_style, dos, donts, phrases, summary, source, created_at: 'T' + voices.length };
      voices.push(row); return [shapeV(row)];
    }
    if (/^\s*SELECT id,caption FROM posts/.test(sql)) { const x = posts[p[0]]; return x && x.user_id === p[1] ? [{ id: p[0], caption: x.caption }] : []; }
    if (/^\s*SELECT count\(\*\)::int n FROM voice_samples/.test(sql)) return [{ n: mine(samples, p[0]).length }];
    if (/^\s*INSERT INTO voice_samples/.test(sql)) { const [uid, kind, text, url, source_post_id] = p; const row = { id: ++sid, user_id: uid, kind, text, url, source_post_id, created_at: 'S' + sid }; samples.push(row); const { user_id, ...o } = row; return [o]; }
    if (/^\s*DELETE FROM voice_samples/.test(sql)) { const i = samples.findIndex(s => s.id === p[0] && s.user_id === p[1]); if (i < 0) return []; samples.splice(i, 1); return [{ id: p[0] }]; }
    throw new Error('unexpected sql ' + sql);
  };
  q.voices = voices; q.samples = samples; q.sqls = sqls; return q;
}
const mk = (over = {}) => {
  const q = over.q ?? fakeQ(), calls = { llm: [], hit: [] };
  const deps = { q, hit: async (...a) => { calls.hit.push(a); return over.budget === false ? { ok: false } : { ok: true }; },
    getLlm: async () => over.cfg === undefined ? null : over.cfg, llm: async (...a) => { calls.llm.push(a); if (over.llmThrows) throw over.llmThrows; return over.llmOut ?? 'AI written summary of the voice.'; } };
  return { q, calls, bv: makeBrandVoice(deps) };
};
const KEY = { key: 'sk-user', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', source: 'user' };

test('O.3 validators: accept good chips, reject bad ones by field name, de-duplicate, null clears', () => {
  const ok = validateVoice({ tone_tags: ['warm', 'playful', 'warm'], formality: 'casual', length_pref: 'short', emoji_use: 'low', hashtag_style: 'niche', do: [' use first person '], dont: ['hype words'], phrases: ['Let’s go'] });
  assert.deepEqual(ok.value, { tone_tags: ['warm', 'playful'], formality: 'casual', length_pref: 'short', emoji_use: 'low', hashtag_style: 'niche', do: ['use first person'], dont: ['hype words'], phrases: ['Let’s go'] });
  for (const [f, v] of [['tone_tags', ['grumpy']], ['tone_tags', TONE_TAGS.slice(0, 6)], ['tone_tags', 'warm'], ['formality', 'stiff'], ['length_pref', 5], ['emoji_use', 'lots'],
    ['hashtag_style', 'spam'], ['do', Array(9).fill('x')], ['do', ['x'.repeat(121)]], ['do', ['']], ['phrases', ['y'.repeat(81)]], ['dont', [3]]]) {
    const r = validateVoice({ [f]: v }); assert.ok(r.error && r.details[0].startsWith(f), `${f}=${JSON.stringify(v)}`);
  }
  assert.ok(validateVoice({ colour: 'red' }).error, 'unknown field is an error, not dropped');
  assert.ok(validateVoice({ summary: 'x' }).error, 'summary is not accepted unless the caller allows it');
  assert.ok(validateVoice([]).error && validateVoice(null).error);
  assert.deepEqual(validateVoice({ tone_tags: null, formality: null, do: null }).value, { tone_tags: [], formality: null, do: [] });
  assert.equal(validateVoice({ summary: '  fine  ' }, { summary: true }).value.summary, 'fine');
  assert.ok(validateVoice({ summary: 'x'.repeat(601) }, { summary: true }).error);
  assert.ok(validateVoice({ summary: null }, { summary: true }).error);
});
test('O.3 merge keeps stored values the change does not mention; chipCount counts options', () => {
  const cur = { tone_tags: ['warm'], formality: 'casual', length_pref: null, emoji_use: 'low', hashtag_style: null, do: ['a'], dont: [], phrases: [] };
  const m = merge(cur, { formality: 'formal', do: [] });
  assert.deepEqual(m, { tone_tags: ['warm'], formality: 'formal', length_pref: null, emoji_use: 'low', hashtag_style: null, do: [], dont: [], phrases: [] });
  assert.equal(chipCount(m), 3); assert.equal(chipCount(merge(null, {})), 0);
});
test('O.3 templateSummary is deterministic, covers every chip, and only mentions example COUNTS (never their text)', () => {
  const v = { tone_tags: ['warm', 'witty'], formality: 'casual', length_pref: 'short', emoji_use: 'none', hashtag_style: 'branded', do: ['ask a question'], dont: ['clickbait'], phrases: ['See you there'] };
  const s = templateSummary(v);
  for (const part of ['warm, witty', 'Casual', 'Short captions', 'No emojis', 'branded tags', 'ask a question', 'Avoid: clickbait', 'See you there']) assert.ok(s.includes(part), part);
  assert.equal(s, templateSummary(v));
  assert.match(templateSummary(merge(null, {}), { liked: 2, disliked: 1 }), /2 liked and 1 disliked/);
  assert.equal(templateSummary(merge(null, {})), '');
});
test('O.3 voiceInstruction: empty without a voice, profile only, bounded', () => {
  assert.equal(voiceInstruction(null), '');
  const t = voiceInstruction({ summary: 'Warm and direct.', tone_tags: ['warm'], formality: 'casual', length_pref: 'short', emoji_use: 'low', dont: ['hype'], do: ['x'.repeat(100)] });
  assert.match(t, /Warm and direct\./); assert.match(t, /tone warm/); assert.match(t, /Never: hype/);
  assert.ok(voiceInstruction({ summary: 'z'.repeat(5000) }).length <= 1500);
});

test('O.3 REGRESSION GUARD: with no voice the caption and hashtag prompts are byte-for-byte the pre-O.3 strings', () => {
  const old = { cap: 'You write Instagram captions. Return JSON {"variants":[{"hook":"","body":"","cta":""}]} with exactly 5 variants.',
    tag: 'Return JSON {"high":[],"mid":[],"niche":[],"branded":[]} totalling 30 Instagram hashtags.' };
  assert.deepEqual(captionPrompt({ topic: 'x' }), { system: old.cap, user: 'Topic: x\nTone: professional\nGoal: engagement\nEmoji level: med' });
  assert.deepEqual(captionPrompt({ topic: 'x', tone: 'funny', goal: 'sales', emoji: 'high' }), { system: old.cap, user: 'Topic: x\nTone: funny\nGoal: sales\nEmoji level: high' });
  assert.deepEqual(hashtagPrompt({ niche: 'coffee' }), { system: old.tag, user: 'Niche: coffee' });
  assert.deepEqual(captionPrompt(undefined, null).user, 'Topic: undefined\nTone: professional\nGoal: engagement\nEmoji level: med');
});
test('O.3 the same request gives a different prompt with and without a voice, and the voice never carries raw samples', () => {
  const voice = { summary: 'Warm, short, playful.', tone_tags: ['warm', 'playful'], formality: 'casual', length_pref: 'short', emoji_use: 'low', hashtag_style: 'niche', dont: ['hype'], samples: [{ text: 'SECRET SAMPLE' }] };
  const a = captionPrompt({ topic: 'launch' }), b = captionPrompt({ topic: 'launch' }, voice);
  assert.notEqual(a.system, b.system); assert.match(b.system, /Warm, short, playful\./); assert.match(b.system, /Never: hype/);
  assert.ok(!JSON.stringify(b).includes('SECRET SAMPLE'));
  assert.match(b.user, /Emoji level: low/, 'voice supplies the emoji default'); assert.match(a.user, /Emoji level: med/);
  assert.match(captionPrompt({ topic: 'x', emoji: 'high' }, voice).user, /Emoji level: high/, 'an explicit request wins over the voice');
  assert.notEqual(hashtagPrompt({ niche: 'c' }).system, hashtagPrompt({ niche: 'c' }, voice).system);
  assert.match(hashtagPrompt({ niche: 'c' }, voice).system, /niche and mid-size/);
  for (const style of HASHTAG_STYLES) assert.notEqual(hashtagPrompt({ niche: 'c' }, { hashtag_style: style }).system, hashtagPrompt({ niche: 'c' }).system, style);
});

test('O.3 PUT /voice creates versions: partial updates merge, every save is a new row, summary is rebuilt from the chips', async () => {
  const { bv, q } = mk();
  let r = await call(bv.put, A, { tone_tags: ['warm'], formality: 'casual' });
  assert.equal(r.body.voice.version, 1); assert.equal(r.body.voice.source, 'edited'); assert.match(r.body.voice.summary, /warm/);
  r = await call(bv.put, A, { emoji_use: 'low' });
  assert.equal(r.body.voice.version, 2); assert.deepEqual(r.body.voice.tone_tags, ['warm']); assert.equal(r.body.voice.formality, 'casual'); assert.equal(r.body.voice.emoji_use, 'low');
  assert.equal(q.voices.length, 2, 'old version kept');
  r = await call(bv.put, A, { summary: 'Hand written.' }); assert.equal(r.body.voice.summary, 'Hand written.'); assert.equal(r.body.voice.version, 3);
  r = await call(bv.get, A); assert.deepEqual(r.body.versions.map(v => v.version), [3, 2, 1]); assert.equal(r.body.voice.version, 3);
  assert.equal((await call(bv.put, B, { emoji_use: 'high' })).body.voice.version, 1, 'versions are per user');
  assert.equal((await call(bv.get, B)).body.voice.emoji_use, 'high'); assert.equal((await call(bv.get, A)).body.voice.emoji_use, 'low');
});
test('O.3 PUT /voice rejects bad input with 400 and writes nothing', async () => {
  const { bv, q } = mk();
  for (const b of [{}, { formality: 'x' }, { nope: 1 }, [], null, { tone_tags: null }, { summary: '' }]) { const r = await call(bv.put, A, b); assert.equal(r.code, 400, JSON.stringify(b)); }
  assert.equal(q.voices.length, 0);
});
test('O.3 two saves at once: a duplicate-version error is retried and the save still lands once', async () => {
  const { bv, q } = mk({ q: fakeQ({ failInsertOnce: true }) });
  const r = await call(bv.put, A, { formality: 'formal' });
  assert.equal(r.code, 200); assert.equal(q.voices.length, 1); assert.equal(q.sqls.filter(s => /INSERT INTO brand_voice/.test(s.sql)).length, 2);
});
test('O.3 the new-version SQL is race safe: casts every parameter and takes max(version)+1 for the same user in one statement', async () => {
  const { bv, q } = mk(); await call(bv.put, A, { formality: 'formal' });
  const s = q.sqls.find(x => /INSERT INTO brand_voice/.test(x.sql)).sql;
  assert.match(s, /coalesce\(max\(version\),0\)\+1/); assert.match(s, /\$1::uuid/); assert.match(s, /FROM brand_voice WHERE user_id=\$1::uuid/); assert.match(s, /\$2::text\[\]/); assert.match(s, /dos,donts/);
});

test('O.3 generate, no consent: template summary, AI never called, no budget spent', async () => {
  const { bv, calls } = mk({ cfg: KEY });
  const r = await call(bv.generate, A, { tone_tags: ['warm'], emoji_use: 'low' });
  assert.equal(r.code, 200); assert.equal(r.body.voice.source, 'template'); assert.deepEqual(r.body.llm, { used: false, reason: 'no_consent' });
  assert.match(r.body.voice.summary, /Tone: warm/); assert.equal(calls.llm.length, 0); assert.equal(calls.hit.length, 0);
});
test('O.3 generate with consent but no OWN key: template, reason no_user_key (the env key is never used for samples)', async () => {
  const { bv, calls } = mk({ cfg: null });
  const r = await call(bv.generate, A, { tone_tags: ['warm'], consent: true });
  assert.deepEqual(r.body.llm, { used: false, reason: 'no_user_key' }); assert.equal(r.body.voice.source, 'template'); assert.equal(calls.llm.length, 0);
});
test('O.3 generate with consent and a user key: the AI summary is stored, the key and the samples reach the llm, the budget is separate', async () => {
  const { bv, calls, q } = mk({ cfg: KEY });
  await call(bv.addSample, A, { kind: 'liked', text: 'Monday coffee hits different.' }); await call(bv.addSample, A, { kind: 'disliked', text: 'BUY NOW!!!' });
  const r = await call(bv.generate, A, { tone_tags: ['witty'], consent: true });
  assert.equal(r.body.voice.source, 'llm'); assert.equal(r.body.voice.summary, 'AI written summary of the voice.'); assert.deepEqual(r.body.llm, { used: true });
  assert.equal(calls.llm.length, 1); const [cfg, voice, samples] = calls.llm[0];
  assert.equal(cfg.key, 'sk-user'); assert.deepEqual(voice.tone_tags, ['witty']); assert.deepEqual(samples.map(s => s.kind), ['liked', 'disliked']);
  assert.equal(calls.hit.length, 1); assert.equal(calls.hit[0][0], 'voice-llm'); assert.notEqual(calls.hit[0][0], 'captions-hashtags');
  assert.equal(q.voices.at(-1).source, 'llm');
});
test('O.3 generate: budget used up, model error, or unusable answer all fall back to the template and say why', async () => {
  for (const [over, reason] of [[{ cfg: KEY, budget: false }, 'budget'], [{ cfg: KEY, llmThrows: new Error('boom') }, 'llm_failed'], [{ cfg: KEY, llmThrows: Object.assign(new Error('bad'), { invalid: true }) }, 'llm_invalid']]) {
    const { bv, calls } = mk(over); const r = await call(bv.generate, A, { tone_tags: ['calm'], consent: true });
    assert.equal(r.code, 200, reason); assert.equal(r.body.llm.reason, reason); assert.equal(r.body.voice.source, 'template'); assert.match(r.body.voice.summary, /calm/);
    if (reason === 'budget') assert.equal(calls.llm.length, 0);
  }
  assert.deepEqual([...LLM_REASONS].sort(), ['budget', 'llm_failed', 'llm_invalid', 'no_consent', 'no_user_key']);
});
test('O.3 generate: nothing to go on is 400; bad chips or a non-boolean consent are 400; examples alone are enough; Redo makes a new version', async () => {
  const { bv, q } = mk();
  assert.equal((await call(bv.generate, A, {})).code, 400); assert.equal((await call(bv.generate, A, { consent: 'yes', tone_tags: ['warm'] })).code, 400);
  assert.equal((await call(bv.generate, A, { tone_tags: ['nope'] })).code, 400); assert.equal((await call(bv.generate, A, [])).code, 400); assert.equal(q.voices.length, 0);
  await call(bv.addSample, A, { kind: 'liked', text: 'one' });
  const r1 = await call(bv.generate, A, {}); assert.equal(r1.code, 200); assert.match(r1.body.voice.summary, /1 liked and 0 disliked/);
  const r2 = await call(bv.generate, A, {}); assert.equal(r2.body.voice.version, r1.body.voice.version + 1);
});
test('O.3 generate merges the chips over the saved voice (Tweak then Generate keeps what was not touched)', async () => {
  const { bv } = mk(); await call(bv.put, A, { tone_tags: ['warm'], formality: 'casual' });
  const r = await call(bv.generate, A, { emoji_use: 'none' });
  assert.deepEqual(r.body.voice.tone_tags, ['warm']); assert.equal(r.body.voice.formality, 'casual'); assert.equal(r.body.voice.emoji_use, 'none');
});

test('O.3 samples: add liked, disliked and links; validation; limit; owner only; deletable per item', async () => {
  const q = fakeQ({ posts: { 7: { user_id: A, caption: ' My own caption ' }, 8: { user_id: B, caption: 'theirs' }, 9: { user_id: A, caption: null } } });
  const { bv } = mk({ q });
  let r = await call(bv.addSample, A, { kind: 'liked', text: '  Great day!  ' }); assert.equal(r.code, 201); assert.equal(r.body.text, 'Great day!'); assert.equal(r.body.url, null);
  r = await call(bv.addSample, A, { kind: 'reference_link', url: 'https://example.com/post/1', text: 'tone I want' }); assert.equal(r.code, 201); assert.equal(r.body.url, 'https://example.com/post/1');
  r = await call(bv.addSample, A, { kind: 'disliked', source_post_id: 7 }); assert.equal(r.code, 201); assert.equal(r.body.text, 'My own caption'); assert.equal(r.body.source_post_id, 7);
  assert.equal((await call(bv.addSample, A, { kind: 'liked', source_post_id: 8 })).code, 404, "someone else's post");
  assert.equal((await call(bv.addSample, A, { kind: 'liked', source_post_id: 9 })).code, 400, 'post without a caption and no text');
  for (const b of [{ kind: 'meh', text: 'x' }, { kind: 'liked' }, { kind: 'liked', text: '' }, { kind: 'liked', text: 'x'.repeat(2001) }, { kind: 'liked', text: 'x', url: 'https://a.co' },
    { kind: 'reference_link', url: 'javascript:alert(1)' }, { kind: 'reference_link', url: 'ftp://x.co/a' }, { kind: 'reference_link' }, { kind: 'reference_link', url: 'https://a.co', source_post_id: 7 },
    { kind: 'reference_link', url: 'https://a.co/' + 'x'.repeat(500) }, { kind: 'liked', text: 'x', source_post_id: 1.5 }, { kind: 'liked', text: 5 }, { kind: 'liked', text: 'x', extra: 1 }, null, []]) {
    assert.equal((await call(bv.addSample, A, b)).code, 400, JSON.stringify(b));
  }
  const g = (await call(bv.get, A)).body; assert.equal(g.samples.length, 3); assert.equal((await call(bv.get, B)).body.samples.length, 0, 'invisible to other users');
  const id = g.samples[0].id;
  assert.equal((await call(bv.removeSample, B, null, { id })).code, 404, "cannot delete someone else's sample");
  assert.equal((await call(bv.removeSample, A, null, { id })).code, 200); assert.equal((await call(bv.get, A)).body.samples.length, 2);
  assert.equal((await call(bv.removeSample, A, null, { id })).code, 404, 'already gone');
  for (const bad of ['abc', '0', '-1', '1.5']) assert.equal((await call(bv.removeSample, A, null, { id: bad })).code, 400, bad);
});
test('O.3 sample limit: the 31st example is refused with a clear message', async () => {
  const { bv, q } = mk();
  for (let i = 0; i < MAX_SAMPLES; i++) assert.equal((await call(bv.addSample, A, { kind: 'liked', text: 'c' + i })).code, 201);
  const r = await call(bv.addSample, A, { kind: 'liked', text: 'one more' }); assert.equal(r.code, 400); assert.match(r.body.error, /limit reached/); assert.equal(q.samples.length, MAX_SAMPLES);
  assert.equal((await call(bv.addSample, B, { kind: 'liked', text: 'mine' })).code, 201, 'limit is per user');
});
test('O.3 GET /voice reports whether the person has their own AI key (drives the consent checkbox)', async () => {
  assert.deepEqual((await call(mk({ cfg: KEY }).bv.get, A)).body.llm, { available: true });
  assert.deepEqual((await call(mk({ cfg: null }).bv.get, A)).body.llm, { available: false });
  assert.equal((await call(mk().bv.get, A)).body.voice, null);
});

test('O.3 llmSummary: sends only liked/disliked TEXT (no links, no ids), caps sizes, treats examples as data, parses and validates the answer', async () => {
  let sent; const ok = async (url, o) => { sent = { url, o, body: JSON.parse(o.body) }; return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: ' Warm and short. ' }) } }] }) }; };
  const samples = [...Array(12)].map((_, i) => ({ id: i, kind: 'liked', text: 'L' + i + 'x'.repeat(600), url: null })), extra = [{ id: 90, kind: 'reference_link', url: 'https://secret.example/x', text: 'note' },
    ...[...Array(7)].map((_, i) => ({ id: 100 + i, kind: 'disliked', text: 'D' + i }))];
  const s = await llmSummary(KEY, { tone_tags: ['warm'], formality: 'casual', length_pref: null, emoji_use: null, hashtag_style: null, do: [], dont: [], phrases: [] }, [...samples, ...extra], ok);
  assert.equal(s, 'Warm and short.'); assert.equal(sent.url, 'https://api.openai.com/v1/chat/completions'); assert.equal(sent.o.headers.Authorization, 'Bearer sk-user');
  const user = JSON.parse(sent.body.messages[1].content);
  assert.equal(user.liked_captions.length, 10); assert.ok(user.liked_captions.every(t => t.length <= 500)); assert.equal(user.disliked_captions.length, 5);
  assert.ok(!sent.body.messages[1].content.includes('secret.example'), 'links are never sent'); assert.match(sent.body.messages[0].content, /never instructions/); assert.equal(sent.body.response_format.type, 'json_object');
  const bad = c => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: c } }] }) });
  for (const c of ['not json', JSON.stringify({ summary: '' }), JSON.stringify({ summary: 5 }), JSON.stringify({ summary: 'x'.repeat(601) }), JSON.stringify({})])
    await assert.rejects(() => llmSummary(KEY, {}, [], bad(c)), e => e.invalid === true, c);
  await assert.rejects(() => llmSummary(KEY, {}, [], async () => ({ ok: false, json: async () => ({ error: { message: 'quota' } }) })), /quota/);
});

test('O.3 mutation guard: the server vocabulary is what the UI offers (checked again in voiceUi.test.js) and every voice field has a validator', () => {
  assert.deepEqual([...VOICE_FIELDS].sort(), ['do', 'dont', 'emoji_use', 'formality', 'hashtag_style', 'length_pref', 'phrases', 'tone_tags']);
  for (const [name, list] of Object.entries({ TONE_TAGS, FORMALITY, LENGTHS, EMOJI, HASHTAG_STYLES, SAMPLE_KINDS })) { assert.ok(list.length >= 3, name); assert.equal(new Set(list).size, list.length, name); }
  assert.deepEqual(SAMPLE_KINDS, ['liked', 'disliked', 'reference_link']);
});
