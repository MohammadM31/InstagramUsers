// Pure advice logic (no DB, no network) so it is easy to unit-test.
// Input is the object produced by pageMetrics() in assistant.js.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Non-technical growth levers (collabs, mentions, reshares, giveaways) rank ABOVE hashtags and new content.
export function advise(m) {
  if (!m.hasData) return [{ priority: 10, kind: 'start', text: 'No posts yet. Import posts or seed demo data so I can read your page.' }];
  const tips = [];
  const add = (priority, kind, text) => tips.push({ priority, kind, text });

  if (m.collabs30d < 2 && m.reachChange < 5)
    add(10, 'collab', 'Run a Collab post with a page of similar size. Shared audiences are your fastest reach boost right now.');
  if (m.mentions30d < 5)
    add(9, 'mention', 'Mention and tag partners, customers or local creators, and ask them to reshare to their Stories. Reshares beat hashtags.');
  if (m.er < 3)
    add(8, 'community', 'Reply to every comment and DM in the first hour after posting. Early replies lift reach.');
  if (m.reachChange < 0)
    add(7, 'giveaway', 'Reach is down. Try a partner giveaway: follow both pages, tag a friend, share to Stories.');
  if (m.topCompetitor)
    add(6, 'swap', `Look at who @${m.topCompetitor} collaborates with. Pitch those creators for a shoutout swap or a joint Live.`);

  const best = [...m.types].sort((a, b) => b.er - a.er)[0];
  if (best && best.er > 0 && best.share < 0.35)
    add(5, 'content', `Post more ${best.type}s. They earn your best engagement (${best.er}%) but are only ${Math.round(best.share * 100)}% of your feed.`);
  if (m.postsPerWeek < 3)
    add(4, 'consistency', `You post about ${m.postsPerWeek}x a week. Aim for 3 to 4 steady posts before adding anything else.`);
  add(1, 'hashtags', 'Refresh hashtags only after the points above.');
  return tips.sort((a, b) => b.priority - a.priority);
}

export function health(m) {
  if (!m.hasData) return { score: 0, label: 'No data yet' };
  const score = Math.round(
    clamp(m.er / 6, 0, 1) * 40 + clamp(m.reachChange / 20, 0, 1) * 30 +
    clamp(m.postsPerWeek / 4, 0, 1) * 20 + clamp(m.collabs30d / 3, 0, 1) * 10);
  return { score, label: score >= 70 ? 'Strong' : score >= 40 ? 'Growing' : 'Needs attention' };
}

// Splits capital by the page's weakest areas and lists the free time/effort work.
export function financePlan(m, capital) {
  const reelShare = m.types.find(t => t.type === 'reel')?.share ?? 0;
  const need = {
    'Creator collaborations': (m.collabs30d < 2 ? 3 : 1) + (m.reachChange < 5 ? 2 : 0),
    'Content production (reels, editing)': (m.postsPerWeek < 3 ? 3 : 1) + (reelShare < 0.3 ? 2 : 0),
    'Paid promotion on best posts': m.er >= 3 ? 3 : 1,
    'Giveaways and community': m.mentions30d < 5 ? 2.5 : 1,
    'Tools and scheduling': 1,
  };
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
