// Roadmap A.1c: account-level Instagram data (follower history, daily account numbers, weekly audience).
// Pure parsers are exported for tests; makeIgAccount takes injected deps like igsync.js. A problem here never stops the post sync:
// igsync.js turns anything thrown from account.sync into a warning.
import { assertMetricsAllowed, IgError } from './instagram.js';

export const MIN_FOLLOWERS = 100;        // Instagram only returns follower_count / demographics above this
export const BACKFILL_DAYS = 30;         // follower_count accepts at most a 30-day window
export const DAILY_METRICS = assertMetricsAllowed(['reach', 'views', 'accounts_engaged', 'profile_links_taps', 'follows_and_unfollows']);
const DAY = 864e5;
export const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
const num = v => (Number.isFinite(v) ? v : null);

// follower_count (period=day) -> [{ day, value }]. Each value is the NET change for one day, not the total.
// UNVERIFIED day mapping: a value's end_time is when its period ended, so the period belongs to the previous UTC date.
export function parseFollowerSeries(resp) {
  const vals = resp?.data?.find(x => x.name === 'follower_count')?.values || [];
  return vals.filter(v => Number.isFinite(v.value) && v.end_time && !Number.isNaN(Date.parse(v.end_time)))
    .map(v => ({ day: dayOf(Date.parse(v.end_time) - DAY), value: v.value }));
}

// Walks back from today's total: followers at the end of day D = total - (net change of every day after D).
// Returns one row per day from (oldest net day - 1) to yesterday, oldest first. Today's row is written separately as 'live'.
export function reconstructHistory(total, series, today) {
  const net = new Map(series.filter(s => s.day < today).map(s => [s.day, s.value]));
  const todayNet = series.find(s => s.day === today)?.value ?? 0;
  if (!Number.isFinite(total) || !net.size) return [];
  const days = [...net.keys()].sort();
  const out = []; let running = total - todayNet; // followers at the end of the last full day
  for (let i = days.length - 1; i >= 0; i--) { out.unshift({ day: days[i], followers: running, net_new: net.get(days[i]) }); running -= net.get(days[i]); }
  out.unshift({ day: dayOf(Date.parse(days[0]) - DAY), followers: running, net_new: null });
  return out.filter(r => r.followers >= 0);
}

// total_value insights -> { reach, views, ... }. follows_and_unfollows arrives as a breakdown; UNVERIFIED label names:
// it is stored only when the labels are exactly FOLLOWS and UNFOLLOWS, otherwise both stay NULL.
export function parseDaily(resp) {
  const out = { reach: null, views: null, accounts_engaged: null, profile_links_taps: null, follows: null, unfollows: null };
  for (const x of resp?.data || []) {
    if (x.name === 'follows_and_unfollows') {
      const rs = x.total_value?.breakdowns?.[0]?.results || [];
      const get = label => rs.find(r => (r.dimension_values || []).some(d => String(d).toUpperCase() === label))?.value;
      if (Number.isFinite(get('FOLLOWS')) && Number.isFinite(get('UNFOLLOWS'))) { out.follows = get('FOLLOWS'); out.unfollows = get('UNFOLLOWS'); }
    } else if (x.name in out) out[x.name] = num(x.total_value?.value);
  }
  return out;
}

// breakdown responses (follower_demographics) -> { age: {'18-24': n}, country: {US: n} }
export function parseBreakdown(resp) {
  const out = {};
  for (const x of resp?.data || []) {
    for (const b of x.total_value?.breakdowns || []) {
      const key = (b.dimension_keys || [])[0]; if (!key) continue;
      out[key] = Object.fromEntries((b.results || []).map(r => [String((r.dimension_values || [])[0]), r.value]).filter(([, v]) => Number.isFinite(v)));
    }
  }
  return out;
}
// online_followers -> { "0": n, ... "23": n } (hour of day -> followers online), from the most recent value
export function parseOnline(resp) {
  const v = resp?.data?.find(x => x.name === 'online_followers')?.values?.at(-1)?.value;
  return v && typeof v === 'object' ? v : null;
}

export function makeIgAccount({ q, graph, now = () => Date.now() }) {
  const unix = ms => Math.floor(ms / 1000);

  // Returns { followers, history, daily, audience, notes[] }. Throws only for token / rate-limit problems, which the caller treats as account-level.
  async function sync(uid, creds) {
    const out = { followers: null, history: 0, daily: 0, audience: false, notes: [] };
    const today = dayOf(now());
    const prof = await graph.get(creds.igUserId, { fields: 'followers_count,media_count' }, creds.token);
    const total = num(prof.followers_count);
    if (total === null) { out.notes.push('Instagram returned no follower count'); return out; }
    out.followers = total;
    const big = total >= MIN_FOLLOWERS;

    // 1. follower history. Under 100 followers Instagram withholds follower_count: store today's total only, with NULL net_new.
    let series = [];
    if (big) {
      try { series = parseFollowerSeries(await graph.get(`${creds.igUserId}/insights`, { metric: 'follower_count', period: 'day', since: unix(now() - 29 * DAY), until: unix(now()) }, creds.token)); }
      catch (e) { if (e.tokenInvalid || e.rateLimited) throw e; out.notes.push('Follower change unavailable: ' + e.message); }
    } else out.notes.push(`Under ${MIN_FOLLOWERS} followers: Instagram withholds daily follower change, so only today's total is stored`);
    const [{ n }] = await q('SELECT count(*)::int n FROM follower_history WHERE user_id=$1', [uid]);
    if (n <= 1 && series.length) // first connect: back-fill (never overwrites a live row)
      for (const r of reconstructHistory(total, series, today))
        out.history += (await q(`INSERT INTO follower_history(user_id,captured_at,followers,net_new,source) VALUES($1,$2,$3,$4,'reconstructed') ON CONFLICT DO NOTHING RETURNING id`, [uid, `${r.day}T12:00:00Z`, r.followers, r.net_new])).length;
    const todayNet = series.find(s => s.day === today)?.value ?? null;
    await q(`INSERT INTO follower_history(user_id,captured_at,followers,net_new,source) VALUES($1,now(),$2,$3,'live')
      ON CONFLICT (user_id,((captured_at AT TIME ZONE 'UTC')::date)) DO UPDATE SET followers=EXCLUDED.followers,net_new=coalesce(EXCLUDED.net_new,follower_history.net_new),source='live'`, [uid, total, todayNet]);
    out.history++;

    // 2. daily account numbers for yesterday and the day before (data lags up to 48 h, so both are refreshed on every run)
    for (const back of [1, 2]) {
      const dayStart = Date.parse(today + 'T00:00:00Z') - back * DAY;
      try {
        const d = parseDaily(await graph.get(`${creds.igUserId}/insights`, { metric: DAILY_METRICS.join(','), metric_type: 'total_value', period: 'day', since: unix(dayStart), until: unix(dayStart + DAY) }, creds.token));
        await q(`INSERT INTO ig_account_daily(user_id,day,reach,views,accounts_engaged,profile_links_taps,follows,unfollows) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(user_id,day) DO UPDATE SET reach=coalesce($3,ig_account_daily.reach),views=coalesce($4,ig_account_daily.views),accounts_engaged=coalesce($5,ig_account_daily.accounts_engaged),
          profile_links_taps=coalesce($6,ig_account_daily.profile_links_taps),follows=coalesce($7,ig_account_daily.follows),unfollows=coalesce($8,ig_account_daily.unfollows)`,
          [uid, dayOf(dayStart), d.reach, d.views, d.accounts_engaged, d.profile_links_taps, d.follows, d.unfollows]);
        out.daily++;
      } catch (e) { if (e.tokenInvalid || e.rateLimited) throw e; out.notes.push('Account insights unavailable: ' + e.message); break; }
    }

    // 3. weekly audience snapshot (100+ followers; at most one per UTC week)
    if (big) {
      const [w] = await q(`SELECT count(*)::int n FROM ig_audience WHERE user_id=$1 AND date_trunc('week',captured_at AT TIME ZONE 'UTC')=date_trunc('week',now() AT TIME ZONE 'UTC')`, [uid]);
      if (!w.n) try {
        const demo = {};
        for (const bd of ['age', 'country']) Object.assign(demo, parseBreakdown(await graph.get(`${creds.igUserId}/insights`, { metric: 'follower_demographics', metric_type: 'total_value', period: 'lifetime', breakdown: bd }, creds.token)));
        const online = parseOnline(await graph.get(`${creds.igUserId}/insights`, { metric: 'online_followers', period: 'lifetime' }, creds.token));
        await q(`INSERT INTO ig_audience(user_id,demographics,online_followers) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [uid, JSON.stringify(demo), online ? JSON.stringify(online) : null]);
        out.audience = true;
      } catch (e) { if (e.tokenInvalid || e.rateLimited) throw e; out.notes.push('Audience data unavailable: ' + e.message); }
    }
    return out;
  }
  return { sync };
}
