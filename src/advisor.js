// Pure advice logic (no DB, no network) so it is easy to unit-test.
// Input is the object produced by pageMetrics() in assistant.js.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isReel = t => /^reel/i.test(String(t ?? '')); // the DB stores 'REEL'; older tests used 'reel'

// Non-technical growth levers (collabs, mentions, reshares, giveaways) rank ABOVE hashtags and new content.
// Every tip carries `why` (the metric that triggered it) and `watch` (the metric to check afterwards).
// Collab/mention counts are ESTIMATES (caption text), and "growth" is reach change, not followers.
export function advise(m) {
  if (!m.hasData) return [{ priority: 10, kind: 'start', text: 'No posts yet. Import posts or seed demo data so I can read your page.', why: 'No posts are stored for this account.', watch: 'Number of posts imported' }];
  const tips = [];
  const add = (priority, kind, text, why, watch) => tips.push({ priority, kind, text, why, watch });

  if (m.collabs30d < 2 && m.reachChange < 5)
    add(10, 'collab', 'Run a Collab post with a page of similar size. Shared audiences are your fastest reach boost right now.',
      `About ${m.collabs30d} collab-style post(s) in the last 30 days (estimated from caption wording) and reach changed ${m.reachChange}% vs the previous 30 days.`,
      'Reach of the collab post vs your average post');
  if (m.mentions30d < 5)
    add(9, 'mention', 'Mention and tag partners, customers or local creators, and ask them to reshare to their Stories. Reshares beat hashtags.',
      `${m.mentions30d} post(s) with an @mention in the last 30 days (estimated from captions).`,
      'Reshares and Story mentions per week');
  if (m.er < 3)
    add(8, 'community', 'Reply to every comment and DM in the first hour after posting. Early replies lift reach.',
      `Engagement rate is ${m.er}%, below the 3% mark.`,
      'Comments per post and engagement rate within 24h of posting');
  if (m.reachChange < 0)
    add(7, 'giveaway', 'Reach is down. Try a partner giveaway: follow both pages, tag a friend, share to Stories.',
      `Reach is ${m.reachChange}% vs the previous 30 days.`,
      'Reach change vs the previous 30 days');
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
  return {
    'Creator collaborations': (m.collabs30d < 2 ? 3 : 1) + (m.reachChange < 5 ? 2 : 0),
    'Content production (reels, editing)': (m.postsPerWeek < 3 ? 3 : 1) + (reelShare < 0.3 ? 2 : 0),
    'Paid promotion on best posts': m.er >= 3 ? 3 : 1,
    'Giveaways and community': m.mentions30d < 5 ? 2.5 : 1,
    'Tools and scheduling': 1,
  };
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
  return { estimate: true, note: 'Estimates from caption text and 30-day reach change. They suggest where to focus, not what caused growth.', categories };
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
  gaps.push('Collabs and mentions are estimated from caption text, and growth is reach change, not followers.');
  return gaps;
}
