// Roadmap O.1: business profile store + onboarding API. Pure validators/defaults plus a factory with injected deps (same pattern as dismissals.js).
// Endpoints: GET /api/onboarding, PATCH /api/onboarding/:step (idempotent), POST /api/onboarding/complete, GET+PUT /api/profile.
export const STEPS = ['about', 'connect', 'business', 'voice', 'goals', 'content'];
// 'connect' (O.2) and 'voice' (O.3) own no profile fields: they can only be marked done or skipped here.
export const STEP_FIELDS = {
  about: ['display_name', 'business_name', 'role', 'timezone', 'languages'],
  connect: [],
  business: ['business_summary', 'offerings', 'niche', 'niche_keywords', 'audience', 'stage'],
  voice: [],
  goals: ['goal_primary', 'goal_secondary', 'goal_target_metric', 'goal_target_value', 'goal_baseline_value', 'goal_deadline'],
  content: ['posts_per_week', 'content_by', 'video_ok', 'auto_proposals'],
};
export const STAGES = ['idea', 'starting', 'growing', 'established'];
export const GOALS = ['followers', 'reach', 'engagement', 'sales', 'leads', 'brand'];
export const TARGET_METRICS = ['followers', 'reach', 'er'];
export const CONTENT_BY = ['me', 'team', 'agency'];
export const REQUIRED_TO_COMPLETE = ['display_name']; // "skipping all but name reaches the Dashboard"

const text = (max) => v => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= max ? v.trim() : undefined;
const oneOf = list => v => list.includes(v) ? v : undefined;
const list = (maxItems, maxLen, item = s => s) => v => {
  if (!Array.isArray(v) || v.length > maxItems) return undefined;
  const out = [];
  for (const x of v) { if (typeof x !== 'string') return undefined; const s = x.trim(); if (!s || s.length > maxLen || !item(s)) return undefined; if (!out.includes(s)) out.push(s); }
  return out;
};
const num = (min, max) => v => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
const bool = v => typeof v === 'boolean' ? v : undefined;
const tz = v => { try { if (typeof v === 'string' && v.length <= 64) { new Intl.DateTimeFormat('en', { timeZone: v }); return v; } } catch { /* invalid zone */ } return undefined; };
const day = v => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const t = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v && t < Date.now() + 5 * 365 * 864e5 ? v : undefined;
};

// field -> { check(value) -> cleaned | undefined, nullable } ; undefined = invalid, null clears an optional field
export const FIELDS = {
  display_name: { check: text(80), nullable: false }, business_name: { check: text(120), nullable: true },
  role: { check: text(80), nullable: true }, timezone: { check: tz, nullable: true },
  languages: { check: list(5, 12, s => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(s)), nullable: true },
  business_summary: { check: text(1000), nullable: true }, offerings: { check: list(10, 80), nullable: true },
  niche: { check: text(80), nullable: true }, niche_keywords: { check: list(15, 40), nullable: true },
  audience: { check: text(300), nullable: true }, stage: { check: oneOf(STAGES), nullable: true },
  goal_primary: { check: oneOf(GOALS), nullable: true }, goal_secondary: { check: oneOf(GOALS), nullable: true },
  goal_target_metric: { check: oneOf(TARGET_METRICS), nullable: true },
  goal_target_value: { check: num(0.0001, 1e12), nullable: true }, goal_baseline_value: { check: num(0, 1e12), nullable: true },
  goal_deadline: { check: day, nullable: true },
  posts_per_week: { check: v => Number.isInteger(v) && v >= 0 && v <= 35 ? v : undefined, nullable: true },
  content_by: { check: oneOf(CONTENT_BY), nullable: true }, video_ok: { check: bool, nullable: true }, auto_proposals: { check: bool, nullable: false },
};
export const ALL_FIELDS = Object.keys(FIELDS);

// Validate a body against an allowed field list. Unknown fields and invalid values are errors (never silently dropped).
export function validateFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be an object' };
  const clean = {}, bad = [];
  for (const [k, v] of Object.entries(body)) {
    if (k === 'skipped') continue;
    const f = allowed.includes(k) && FIELDS[k];
    if (!f) { bad.push(`${k}: not a field of this step`); continue; }
    if (v === null) { if (f.nullable) clean[k] = null; else bad.push(`${k}: cannot be cleared`); continue; }
    const c = f.check(v);
    if (c === undefined) bad.push(`${k}: invalid value`); else clean[k] = c;
  }
  if (!bad.length && clean.goal_primary && clean.goal_primary === clean.goal_secondary) bad.push('goal_secondary: must differ from goal_primary');
  return bad.length ? { error: 'invalid input', details: bad } : { value: clean };
}

// The step to show next after `step` was saved or skipped; never moves backwards when an earlier step is edited.
export function advance(current, step) {
  const cur = STEPS.indexOf(current), done = STEPS.indexOf(step);
  if (current === 'done') return 'done';
  const next = Math.max(cur < 0 ? 0 : cur, done + 1);
  return next >= STEPS.length ? 'done' : STEPS[next];
}

const SELECT = `SELECT display_name,business_name,role,timezone,languages,business_summary,offerings,niche,niche_keywords,audience,stage,goal_primary,goal_secondary,
  goal_target_metric,goal_target_value::float goal_target_value,goal_baseline_value::float goal_baseline_value,to_char(goal_deadline,'YYYY-MM-DD') goal_deadline,
  posts_per_week,content_by,video_ok,auto_proposals,onboarding_step,skipped_steps,completed_at,updated_at FROM business_profile WHERE user_id=$1`;

const shape = row => {
  const profile = {}; for (const f of ALL_FIELDS) profile[f] = row ? row[f] ?? (f === 'auto_proposals' ? false : null) : (f === 'auto_proposals' ? false : null);
  return {
    profile, step: row?.onboarding_step ?? STEPS[0], skippedSteps: row?.skipped_steps ?? [], completed: !!row?.completed_at,
    completedAt: row?.completed_at ?? null, steps: STEPS,
  };
};

export function makeOnboarding({ q }) {
  const load = async uid => (await q(SELECT, [uid]))[0];

  async function save(uid, clean, step, skip) {
    const cur = await load(uid);
    const skipped = new Set(cur?.skipped_steps ?? []);
    if (step) { if (skip) skipped.add(step); else skipped.delete(step); }
    const nextStep = step ? advance(cur?.onboarding_step ?? STEPS[0], step) : cur?.onboarding_step ?? STEPS[0];
    const cols = Object.keys(clean), vals = cols.map(c => clean[c]);
    const ins = ['user_id', ...cols, 'onboarding_step', 'skipped_steps'], ph = ins.map((_, i) => `$${i + 1}`);
    const sets = [...cols, 'onboarding_step', 'skipped_steps'].map(c => `${c}=EXCLUDED.${c}`).concat('updated_at=now()');
    await q(`INSERT INTO business_profile(${ins.join(',')}) VALUES(${ph.join(',')}) ON CONFLICT(user_id) DO UPDATE SET ${sets.join(',')}`, [uid, ...vals, nextStep, [...skipped]]);
  }

  const get = async (req, res) => res.json(shape(await load(req.uid)));

  // PATCH /api/onboarding/:step  body: the step's fields, or { skipped: true }. Saving the same body twice leaves one row.
  const patchStep = async (req, res) => {
    const step = req.params.step;
    if (!STEPS.includes(step)) return res.status(404).json({ error: 'unknown step' });
    const skip = req.body?.skipped === true;
    if (skip && step === 'about') return res.status(400).json({ error: 'the first step cannot be skipped: a display name is required' });
    if (skip && Object.keys(req.body).some(k => k !== 'skipped')) return res.status(400).json({ error: 'send either skipped:true or the step fields, not both' });
    const v = skip ? { value: {} } : validateFields(req.body ?? {}, STEP_FIELDS[step]);
    if (v.error) return res.status(400).json(v);
    await save(req.uid, v.value, step, skip);
    res.json(shape(await load(req.uid)));
  };

  // POST /api/onboarding/complete: needs a display name; idempotent (the first completion time is kept)
  const complete = async (req, res) => {
    const cur = await load(req.uid);
    if (!cur || REQUIRED_TO_COMPLETE.some(f => !cur[f])) return res.status(400).json({ error: 'a display name is required to finish', missing: REQUIRED_TO_COMPLETE.filter(f => !cur?.[f]) });
    await q(`UPDATE business_profile SET completed_at=coalesce(completed_at,now()),onboarding_step='done',updated_at=now() WHERE user_id=$1`, [req.uid]);
    res.json(shape(await load(req.uid)));
  };

  // GET/PUT /api/profile (O.6 edit later): any field of any step; PUT is a partial update. Does not change onboarding progress.
  const getProfile = async (req, res) => res.json(shape(await load(req.uid)).profile);
  const putProfile = async (req, res) => {
    const v = validateFields(req.body ?? {}, ALL_FIELDS);
    if (v.error) return res.status(400).json(v);
    if (!Object.keys(v.value).length) return res.status(400).json({ error: 'nothing to update' });
    if (!(await load(req.uid))) return res.status(409).json({ error: 'start onboarding first' });
    await save(req.uid, v.value, null, false);
    res.json(shape(await load(req.uid)).profile);
  };
  return { get, patchStep, complete, getProfile, putProfile, load };
}
