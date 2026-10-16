// Pure advice logic (no DB, no network) so it is easy to unit-test.
// Input is the object produced by pageMetrics() in assistant.js.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isReel = t => /^reel/i.test(String(t ?? '')); // the DB stores 'REEL'; older tests used 'reel'

// Roadmap A.1c. m.followerSeries = [{ day:'YYYY-MM-DD', followers, source }] oldest first (from follower_history).
// A window (7 or 30 days) is reported only when a point at or before that distance exists; otherwise it is null, never guessed.
export function followerGrowth(m) {
  const s = (m?.followerSeries || []).filter(x => Number.isFinite(x.followers) && x.day).sort((a, b) => a.day.localeCompare(b.day));
  const none = { hasData: false, followers: null, value30d: null, value7d: null, pct30d: null, pct7d: null, direction: null, reconstructed: false };
  if (!s.length) return none;
  const last = s[s.length - 1], t = Date.parse(last.day + 'T00:00:00Z');
  const ref = n => [...s].reverse().find(x => Date.parse(x.day + 'T00:00:00Z') <= t - n * 864e5);
  const win = n => { const r = ref(n); return r ? { v: last.followers - r.followers, p: r.followers > 0 ? +(((last.followers - r.followers) / r.followers) * 100).toFixed(1) : null, rec: r.source === 'reconstructed' } : null; };
  const a = win(30), b = win(7), lead = b ?? a;
  return { hasData: true, followers: last.followers, value30d: a ? a.v : null, value7d: b ? b.v : null, pct30d: a ? a.p : null, pct7d: b ? b.p : null,
    direction: !lead || lead.p === null ? null : lead.p > 0 ? 'up' : lead.p < 0 ? 'down' : 'flat', reconstructed: !!(a?.rec || b?.rec) };
}

// Roadmap O.4. The person's main goal (m.goal, from business_profile.goal_primary) nudges the ranking. The multipliers and bonuses
// are my choices (see AI_DECISIONS); with no goal, or a goal not listed here, nothing changes.
export const GOAL_AREA_FOCUS = {
  followers: { 'Creator collaborations': 1.5, 'Giveaways and community': 1.5 },
  reach: { 'Content production (reels, editing)': 1.5, 'Creator collaborations': 1.25 },
  engagement: { 'Giveaways and community': 1.5, 'Content production (reels, editing)': 1.25 },
  sales: { 'Paid promotion on best posts': 1.5 },
  leads: { 'Paid promotion on best posts': 1.25, 'Giveaways and community': 1.25 },
  brand: { 'Content production (reels, editing)': 1.5, 'Creator collaborations': 1.25 },
};
export const GOAL_TIP_BONUS = {
  followers: { collab: 2, giveaway: 2, mention: 1 },
  reach: { content: 2, collab: 1, consistency: 1 },
  engagement: { community: 3, giveaway: 1 },
  sales: { content: 1, community: 1 },
  leads: { community: 2, mention: 1 },
  brand: { content: 2, consistency: 2 },
};

// Non-technical growth levers (collabs, mentions, reshares, giveaways) rank ABOVE hashtags and new content.
// Every tip carries `why` (the metric that triggered it) and `watch` (the metric to check afterwards).
// Collab/mention counts are ESTIMATES (caption text), and "growth" is reach change, not followers.
export function advise(m) {
  if (!m.hasData) return [{ priority: 10, kind: 'start', text: 'No posts yet. Import posts or seed demo data so I can read your page.', why: 'No posts are stored for this account.', watch: 'Number of posts imported' }];
  const tips = [];
  const add = (priority, kind, text, why, watch) => tips.push({ priority, kind, text, why, watch });
  // Growth = follower change over 30 days when Instagram history exists, reach change otherwise (A.1c). The follower thresholds are my choice (see AI_DECISIONS).
  const fg = followerGrowth(m), useF = fg.pct30d !== null;
  const growth = useF ? fg.pct30d : m.reachChange, basis = useF ? 'followers' : 'reach';
  const growthTxt = useF ? `followers changed ${fg.pct30d}% over 30 days` : `reach changed ${m.reachChange}% vs the previous 30 days`;
  if (fg.pct7d !== null && fg.pct7d < -1)
    add(11, 'follower_drop', `Followers fell ${Math.abs(fg.pct7d)}% in 7 days (${fg.value7d}). Check what you posted just before the drop, and reply to comments and messages today.`,
      `Followers went from ${fg.followers - fg.value7d} to ${fg.followers} in 7 days (Instagram follower count).${fg.reconstructed ? ' Part of this history is reconstructed from daily changes.' : ''} This shows a change, not its cause.`,
      'Follower change over the next 7 days');

  if (m.collabs30d < 2 && growth < (useF ? 2 : 5))
    add(10, 'collab', 'Run a Collab post with a page of similar size. Shared audiences are your fastest reach boost right now.',
      `About ${m.collabs30d} collab-style post(s) in the last 30 days (estimated from caption wording) and ${growthTxt}.`,
      useF ? 'Followers gained after the collab post' : 'Reach of the collab post vs your average post');
  if (m.mentions30d < 5)
    add(9, 'mention', 'Mention and tag partners, customers or local creators, and ask them to reshare to their Stories. Reshares beat hashtags.',
      `${m.mentions30d} post(s) with an @mention in the last 30 days (estimated from captions).`,
      'Reshares and Story mentions per week');
  if (m.er < 3)
    add(8, 'community', 'Reply to every comment and DM in the first hour after posting. Early replies lift reach.',
      `Engagement rate is ${m.er}%, below the 3% mark.`,
      'Comments per post and engagement rate within 24h of posting');
  if (growth < 0)
    add(7, 'giveaway', `${useF ? 'Followers are' : 'Reach is'} down. Try a partner giveaway: follow both pages, tag a friend, share to Stories.`,
      useF ? `Followers changed ${fg.pct30d}% over 30 days (Instagram follower count).` : `Reach is ${m.reachChange}% vs the previous 30 days.`,
      useF ? 'Follower change over 30 days' : 'Reach change vs the previous 30 days');
  if (m.topCompetitor)
    add(6, 'swap', `Look at who @${m.topCompetitor} collaborates with. Pitch those creators for a shoutout swap or a joint Live.`,
      `@${m.topCompetitor} is the largest competitor you track.`,
      'Reach on swap or Live posts vs your average');

  const best = [...m.types].sort((a, b) => b.er - a.er)[0];
  if (best && best.er > 0 && best.share < 0.35)
    add(5, 'content', `Post more ${best.type}s. They earn your best engagement (${best.er}%) but are only ${Math.round(best.share * 100)}% of your feed.`,
      `${best.type} has your highest engagement (${best.er}%) but only ${Math.round(best.share * 100)}% of posts. This is a correlation, not proof that more of them will perform the same.`,
      `Engagement rate by format after you post more ${best.type}s`);
  if (m.postsPerWeek < 3)
    add(4, 'consistency', `You post about ${m.postsPerWeek}x a week. Aim for 3 to 4 steady posts before adding anything else.`,
      `${m.postsPerWeek} posts per week over the last 30 days.`,
      'Posts per week');
  add(1, 'hashtags', 'Refresh hashtags only after the points above.',
    'Hashtags are the lowest-impact lever in this list.',
    'Reach from hashtags in Instagram Insights');
  // O.4: a stated goal lifts the tips that serve it. The reason is added to `why`; the tip text and its other fields are unchanged.
  const bonus = GOAL_TIP_BONUS[m.goal];
  if (bonus) tips.forEach(t => { if (bonus[t.kind]) { t.priority += bonus[t.kind]; t.why += ` Ranked higher because your main goal is ${m.goal}.`; } });
  return tips.sort((a, b) => b.priority - a.priority);
}

export function health(m) {
  if (!m.hasData) return { score: 0, label: 'No data yet' };
  const score = Math.round(
    clamp(m.er / 6, 0, 1) * 40 + clamp(m.reachChange / 20, 0, 1) * 30 +
    clamp(m.postsPerWeek / 4, 0, 1) * 20 + clamp(m.collabs30d / 3, 0, 1) * 10);
  return { score, label: score >= 70 ? 'Strong' : score >= 40 ? 'Growing' : 'Needs attention' };
}

// Shared weights: how much each marketing area needs attention right now.
// Used by financePlan() (to split capital) and marketingBreakdown() (to explain where effort should go).
export function needWeights(m) {
  const reelShare = m.types.find(t => isReel(t.type))?.share ?? 0;
  const w = {
    'Creator collaborations': (m.collabs30d < 2 ? 3 : 1) + (m.reachChange < 5 ? 2 : 0),
    'Content production (reels, editing)': (m.postsPerWeek < 3 ? 3 : 1) + (reelShare < 0.3 ? 2 : 0),
    'Paid promotion on best posts': m.er >= 3 ? 3 : 1,
    'Giveaways and community': m.mentions30d < 5 ? 2.5 : 1,
    'Tools and scheduling': 1,
  };
  const focus = GOAL_AREA_FOCUS[m.goal]; // O.4: the goal re-weights; every caller (finance split, breakdown) therefore agrees
  if (focus) for (const [area, f] of Object.entries(focus)) w[area] = +(w[area] * f).toFixed(2);
  return w;
}

// Splits capital by the page's weakest areas and lists the free time/effort work.
export function financePlan(m, capital) {
  const need = needWeights(m);
  const total = Object.values(need).reduce((a, b) => a + b, 0);
  const money = Object.entries(need)
    .map(([area, w]) => ({ area, share: Math.round((w / total) * 100), amount: Math.round((w / total) * capital) }))
    .sort((a, b) => b.amount - a.amount);
  if (m.er < 2) money.forEach(x => { if (x.area.startsWith('Paid')) x.note = 'hold off until engagement improves'; });

  const time = [];
  if (m.postsPerWeek < 3) time.push('Time: batch-shoot a full week of content in one sitting.');
  if (m.er < 3) time.push('Effort: reply to every comment within the first hour.');
  if (m.collabs30d < 2) time.push('Effort: pitch 5 partner pages this week. It costs nothing.');
  return { capital, money, time };
}

const CORRELATION = 'Correlation, not causation: this shows where to look, not what caused the result.';

// Roadmap 1.4. Which marketing methods deserve attention, with the evidence, how sure we are, and what to measure.
// Everything here is an ESTIMATE: collabs/mentions come from caption text, and "growth" is reach change, not followers.
export function marketingBreakdown(m) {
  if (!m.hasData) return { estimate: true, note: 'No posts yet, so there is nothing to break down.', categories: [] };
  const w = needWeights(m);
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const enough = (m.posts30d ?? 0) >= 8; // fewer than ~8 posts in 30 days is too little to trust
  const reel = m.types.find(t => isReel(t.type));
  const info = {
    'Creator collaborations': {
      evidence: `About ${m.collabs30d} collab-style post(s) in 30 days (estimated from caption wording). Reach changed ${m.reachChange}% vs the previous 30 days (reach, not followers).`,
      confidence: 'low', suggestedMetric: 'Reach of collab posts vs your average post' },
    'Content production (reels, editing)': {
      evidence: `${m.postsPerWeek} posts per week. Reels are ${Math.round((reel?.share ?? 0) * 100)}% of your posts.`,
      confidence: enough ? 'medium' : 'low', suggestedMetric: 'Posts per week and engagement rate by format' },
    'Paid promotion on best posts': {
      evidence: `Engagement rate is ${m.er}%. Paid reach pays off mainly on posts that already engage.`,
      confidence: enough && m.er > 0 ? 'medium' : 'low', suggestedMetric: 'Cost per extra 1,000 reach on promoted posts' },
    'Giveaways and community': {
      evidence: `${m.mentions30d} post(s) with an @mention in 30 days (estimated from captions).`,
      confidence: 'low', suggestedMetric: 'Comments, reshares and Story mentions per week' },
    'Tools and scheduling': {
      evidence: 'No performance signal for this area. It stays a small fixed share.',
      confidence: 'low', suggestedMetric: 'Hours spent per week on publishing' },
  };
  const categories = Object.entries(w).map(([name, weight]) => {
    const i = info[name];
    return { name, weight, share: Math.round((weight / total) * 100), ...i, ...(i.confidence === 'low' ? { caveat: CORRELATION } : {}) };
  }).sort((a, b) => b.weight - a.weight);
  const focus = GOAL_AREA_FOCUS[m.goal] || {};
  categories.forEach(c => { if (focus[c.name]) { c.goalBoost = true; c.evidence += ` Weighted up because your main goal is ${m.goal}.`; } });
  return { estimate: true, goal: m.goal && GOAL_AREA_FOCUS[m.goal] ? m.goal : null, note: 'Estimates from caption text and 30-day reach change. They suggest where to focus, not what caused growth.', categories };
}

// Roadmap 1.2. Builds the "what does the AI know about this page" gap list. Pure, so it is unit-tested.
// s = { posts, spanDays, competitors, scrapedCompetitors, demoPosts, imports, snapshotDays, competitorSource }
export function contextGaps(m, s) {
  const gaps = [];
  if (!s.posts) { gaps.push('No posts yet. Import posts in Settings so the advice is about your page.'); return gaps; }
  if (s.demoPosts && s.demoPosts >= s.posts / 2) gaps.push('This page is still running on seeded demo data. Import your real posts in Settings.');
  else if (!s.imports) gaps.push('Posts were not imported through Settings, so freshness is unknown.');
  if (s.posts < 10) gaps.push(`Only ${s.posts} post(s). Advice gets reliable from about 10 posts.`);
  if (s.spanDays < 60) gaps.push(`Your posts cover ${s.spanDays} day(s). The change vs the previous 30 days needs about 60 days.`);
  if (!s.competitors) gaps.push('No competitors tracked, so benchmarking and swap ideas are missing.');
  else if (!s.scrapedCompetitors) gaps.push('Competitors are added but never scraped.');
  if (s.competitorSource === 'demo') gaps.push('Competitor data is synthetic demo data (no Instagram Graph API token configured).');
  if (!s.snapshotDays) gaps.push('No daily snapshots yet. Trends and notifications need a few days of history.');
  else if (s.snapshotDays < 3) gaps.push(`Only ${s.snapshotDays} day(s) of snapshots. Monitoring needs at least 3.`);
  if (s.igConnected && s.followersAtLastSync !== undefined && s.followersAtLastSync !== null && s.followersAtLastSync < 100)
    gaps.push('Under 100 followers: Instagram withholds follower history, audience and online-time data until the account passes 100.');
  if (followerGrowth(m).pct30d !== null) gaps.push('Collabs and mentions are estimated from caption text. Growth is follower count (Instagram Insights).');
  else gaps.push('Collabs and mentions are estimated from caption text, and growth is reach change, not followers.');
  return gaps;
}

// ---------------------------------------------------------------------------------------------
// Roadmap 2.2: per-post analysis. Pure: `post` is a posts row (+ optional `er` in %), `snapshots` are post_snapshots rows,
// `m` is pageMetrics(). Returns { text, delta }. It compares numbers; it never claims to know what CAUSED them.
// ---------------------------------------------------------------------------------------------
const num0 = v => Number(v) || 0;
const interactionsOf = p => num0(p.likes) + num0(p.comments) + num0(p.saves) + num0(p.shares);
const erOf = p => (num0(p.reach) > 0 ? +(interactionsOf(p) * 100 / num0(p.reach)).toFixed(2) : null);
const nice = n => Math.round(Number(n)).toLocaleString('en-US');
const dayKey = v => new Date(v).toISOString().slice(0, 10);
const vs = (er, ref) => { const d = er - ref; return d >= 0.5 ? 'above' : d <= -0.5 ? 'below' : 'in line with'; };

// Needs snapshots on at least two different UTC days; otherwise there is no trend to report.
export function snapshotDelta(snapshots) {
  const s = [...(snapshots || [])].sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));
  const days = new Set(s.map(x => dayKey(x.captured_at)));
  if (s.length < 2 || days.size < 2) return null;
  const a = s[0], b = s[s.length - 1], ea = erOf(a), eb = erOf(b);
  const pct = (x, y) => (num0(x) ? +(((num0(y) - num0(x)) / num0(x)) * 100).toFixed(1) : null);
  return {
    since: a.captured_at, until: b.captured_at, days: days.size,
    reach: { from: num0(a.reach), to: num0(b.reach), pct: pct(a.reach, b.reach) },
    interactions: { from: interactionsOf(a), to: interactionsOf(b), pct: pct(interactionsOf(a), interactionsOf(b)) },
    er: { from: ea, to: eb, points: ea !== null && eb !== null ? +(eb - ea).toFixed(2) : null },
  };
}

export function postAnalysis(post, snapshots, m) {
  const er = post.er !== undefined && post.er !== null ? Number(post.er) : erOf(post);
  const delta = snapshotDelta(snapshots);
  const parts = [];

  if (er === null || Number.isNaN(er)) {
    parts.push('No reach is recorded for this post, so its engagement rate cannot be calculated.');
  } else {
    const typeEr = m?.types?.find(t => t.type === post.type)?.er;
    const pageEr = m?.hasData ? m.er : null;
    let s = `This ${post.type} reached ${nice(post.reach)} accounts with an engagement rate of ${er}%.`;
    if (typeEr) s += ` That is ${vs(er, typeEr)} your average ${post.type} (${typeEr}%).`;
    if (pageEr) s += ` Your page averaged ${pageEr}% over the last 30 days.`;
    parts.push(s);
    const total = interactionsOf(post);
    if (total > 0) {
      const comp = [['likes', post.likes], ['comments', post.comments], ['saves', post.saves], ['shares', post.shares]]
        .map(([k, v]) => [k, num0(v)]).sort((a, b) => b[1] - a[1]);
      parts.push(`Most of its engagement came from ${comp[0][0]} (${Math.round(comp[0][1] * 100 / total)}% of ${nice(total)} interactions).`);
    }
  }

  if (delta) {
    const sign = v => (v > 0 ? '+' : '') + v;
    let s = `Over ${delta.days} days of snapshots, reach went from ${nice(delta.reach.from)} to ${nice(delta.reach.to)}`;
    if (delta.reach.pct !== null) s += ` (${sign(delta.reach.pct)}%)`;
    s += delta.er.points !== null ? ` and engagement rate moved ${sign(delta.er.points)} points.` : '.';
    parts.push(s);
  } else {
    const n = (snapshots || []).length;
    parts.push(`No trend yet: it needs snapshots from at least 2 different days (${n} so far).`);
  }
  parts.push('This compares numbers. It does not show what caused them.');
  return { text: parts.join(' '), delta };
}

// ---------------------------------------------------------------------------------------------
// Roadmap 2.3: alert detection. Pure. Everything is measured against the user's stored baseline (metrics_baseline),
// so the first run after a baseline exists cannot raise a "sudden change" alert.
//   base = { reach30d, er, best_post_er, ahead }   ahead === null means "competitors not baselined yet"
//   cur  = { reach30d, er, best_post_er, userAvgLc, competitors }   competitors === null means "no usable competitor data"
//          competitors = [{ handle, avgLc, n }]  avgLc = average likes+comments per post (reach is not public for other accounts)
// Returns { alerts: [{kind,title,body,watch,key}], state: { best_post_er, ahead } } where state is what the baseline should store next.
// ---------------------------------------------------------------------------------------------
export const ALERT_RULES = { reachDropPct: 15, erDropPoints: 2, minCompetitorPosts: 3 };

export function detectAlerts(base, cur, now = Date.now()) {
  const week = Math.floor(now / 6048e5); // a persistent drop alerts once per week, not every hour
  const alerts = [], n = v => (v === null || v === undefined ? null : Number(v));
  const bReach = n(base.reach30d), cReach = n(cur.reach30d), bEr = n(base.er), cEr = n(cur.er), bBest = n(base.best_post_er), cBest = n(cur.best_post_er);

  if (bReach > 0 && cReach !== null && cReach < bReach * (1 - ALERT_RULES.reachDropPct / 100)) {
    const pct = Math.round((cReach / bReach - 1) * 100);
    alerts.push({ kind: 'reach_drop', key: `reach_drop:w${week}`,
      title: `Reach is down ${Math.abs(pct)}% since tracking started`,
      body: `Reach over the last 30 days is ${nice(cReach)}, against ${nice(bReach)} when tracking started. If you have posted less recently, older posts have aged out of the 30-day window.`,
      watch: 'Reach over the last 30 days, and posts per week' });
  }
  if (bEr !== null && cEr !== null && bEr - cEr > ALERT_RULES.erDropPoints) {
    alerts.push({ kind: 'er_drop', key: `er_drop:w${week}`,
      title: `Engagement rate is down ${+(bEr - cEr).toFixed(1)} points`,
      body: `Engagement rate over the last 30 days is ${cEr}%, against ${bEr}% when tracking started.`,
      watch: 'Engagement rate and comments per post' });
  }

  let best = bBest;
  if (cBest !== null && (bBest === null || cBest > bBest)) {
    if (bBest !== null) alerts.push({ kind: 'best_post', key: `best_post:${cBest}`,
      title: 'New best-ever post',
      body: `A post now has an engagement rate of ${cBest}%, above your previous best of ${bBest}%.`,
      watch: 'Whether the next posts of the same type hold that rate' });
    best = cBest; // stored either way, so it alerts once
  }

  let ahead = base.ahead ?? null;
  if (cur.competitors) {
    const now_ahead = cur.userAvgLc === null || cur.userAvgLc === undefined ? [] :
      cur.competitors.filter(c => c.n >= ALERT_RULES.minCompetitorPosts && c.avgLc > cur.userAvgLc).map(c => c.handle).sort();
    if (base.ahead) {
      for (const c of cur.competitors.filter(c => now_ahead.includes(c.handle) && !base.ahead.includes(c.handle)))
        alerts.push({ kind: 'competitor', key: `competitor:${c.handle}:w${week}`,
          title: `@${c.handle} now out-engages you`,
          body: `@${c.handle} averages ${nice(c.avgLc)} likes and comments per post over the last 30 days, against ${nice(cur.userAvgLc)} for you. Reach is not public for other accounts, so this compares likes and comments only.`,
          watch: 'Likes and comments per post, yours vs theirs' });
    }
    ahead = now_ahead; // first run: baseline only, no alerts
  }
  return { alerts, state: { best_post_er: best, ahead } };
}

// Roadmap O.4. Progress towards the stored goal. Pure: profile = business_profile fields, m = pageMetrics().
// Data used: follower_history for a followers goal (Instagram follower count; part may be reconstructed), the 30-day reach from posts for a
// reach goal, the 30-day average engagement rate for an er goal. A followers goal with no follower history is NOT converted from reach:
// the answer says so and shows the reach trend separately. `needsBaseline` tells the caller to store `currentValue` as the starting value.
export function goalProgress(profile, m, now = Date.now()) {
  const p = profile || {}, metric = p.goal_target_metric ?? null;
  const out = { hasGoal: false, goal: p.goal_primary ?? null, metric, current: null, baseline: null, target: null, deadline: p.goal_deadline ?? null, daysLeft: null,
    percent: null, pace: null, projected: null, achieved: false, needsBaseline: false, currentValue: null, explanation: '', dataUsed: null };
  if (!metric || p.goal_target_value == null || !Number.isFinite(Number(p.goal_target_value))) {
    out.explanation = 'No numeric target is set yet, so there is no progress to show. Pick a measure and a target number in your goal.'; return out;
  }
  const target = Number(p.goal_target_value), fg = followerGrowth(m);
  let current = null, rate = null, unit = '', dataUsed = null, extra = '';
  if (metric === 'followers') {
    unit = 'followers';
    if (fg.hasData) {
      current = fg.followers; rate = fg.value30d != null ? fg.value30d / 30 : fg.value7d != null ? fg.value7d / 7 : null;
      dataUsed = { source: 'follower_history', label: 'Instagram follower count' + (fg.reconstructed ? ' (part of the history is reconstructed from daily changes)' : '') };
    } else if (m?.hasData) extra = ` Your reach changed ${m.reachChange}% vs the previous 30 days, but that is reach, not followers, so it is not used as progress.`;
  } else if (metric === 'reach') {
    unit = 'reach'; if (m?.hasData) {
      current = m.reach30d; const rc = Number(m.reachChange);
      if (Number.isFinite(rc) && rc !== 0 && rc > -100) rate = (m.reach30d - m.reach30d / (1 + rc / 100)) / 30; // change of the 30-day total per day; 0% cannot be told apart from "no earlier period"
      dataUsed = { source: 'reach', label: 'Reach over the last 30 days (from posts, estimate of the trend)' };
    }
  } else {
    unit = '% engagement rate'; if (m?.hasData) { current = m.er; dataUsed = { source: 'engagement_rate', label: 'Average engagement rate over the last 30 days (from posts)' }; }
  }
  out.hasGoal = true; out.target = target; out.dataUsed = dataUsed;
  const name = { followers: 'followers', reach: '30-day reach', er: 'engagement rate' }[metric];
  if (current === null) { out.explanation = `No ${metric === 'followers' ? 'Instagram follower history' : 'post data'} yet, so progress towards ${target.toLocaleString('en-US')} ${name} cannot be measured.` + extra; return out; }
  out.current = current;
  const base = p.goal_baseline_value == null ? null : Number(p.goal_baseline_value);
  if (base === null) { out.needsBaseline = true; out.currentValue = current; out.explanation = `Your starting value has not been recorded yet. It will be today's ${name}: ${current.toLocaleString('en-US')}.`; return out; }
  out.baseline = base;
  const dir = target >= base ? 1 : -1, span = (target - base) * dir;
  const raw = span === 0 ? (current * dir >= target * dir ? 100 : 0) : ((current - base) / (target - base)) * 100;
  out.percent = +Math.min(100, Math.max(0, raw)).toFixed(1);
  out.achieved = current * dir >= target * dir;
  let daysLeft = null;
  if (p.goal_deadline) { const d = Date.parse(String(p.goal_deadline).slice(0, 10) + 'T23:59:59Z'); if (Number.isFinite(d)) daysLeft = Math.ceil((d - now) / 864e5); }
  out.daysLeft = daysLeft;
  const fmt = n => (Math.abs(n) >= 100 ? Math.round(n) : +n.toFixed(2)).toLocaleString('en-US');
  let pace = null, why = '';
  if (out.achieved) { pace = 'ahead'; why = 'The target has been reached.'; }
  else if (daysLeft === null) why = 'No deadline is set, so there is no pace to judge.';
  else if (daysLeft < 0) { pace = 'behind'; why = `The deadline passed ${-daysLeft} day(s) ago and the target is not reached.`; }
  else if (rate === null) why = metric === 'er' ? 'Engagement rate has no trend data here, so the pace is not judged.' : 'There is not enough history yet to judge the pace.';
  else {
    const need = (target - current) * dir, gain = rate * dir * daysLeft, ratio = gain / need;
    out.projected = +(current + rate * daysLeft).toFixed(metric === 'er' ? 2 : 0);
    pace = ratio >= 1.1 ? 'ahead' : ratio >= 0.9 ? 'on track' : 'behind';
    why = `At the recent rate (${fmt(rate * dir)} ${unit} per day) you would reach about ${fmt(out.projected)} by the deadline, ${daysLeft} day(s) away.`;
  }
  out.pace = pace;
  out.explanation = `${name[0].toUpperCase() + name.slice(1)}: ${fmt(current)} now, started at ${fmt(base)}, target ${fmt(target)} (${out.percent}% of the way). ${why}${extra} This is a projection from recent change, not a promise.`;
  return out;
}
