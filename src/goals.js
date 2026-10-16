// Roadmap O.4: GET /api/goal. Dependencies are injected (same pattern as insights.js). The maths is advisor.goalProgress (pure).
// The starting value is recorded the first time the goal can be measured after it was set (onboarding.save clears it when the measure or target changes).
import { goalProgress } from './advisor.js';

const COLS = `goal_primary,goal_secondary,goal_target_metric,goal_target_value::float goal_target_value,goal_baseline_value::float goal_baseline_value,to_char(goal_deadline,'YYYY-MM-DD') goal_deadline`;

export function makeGoals({ q, pageMetrics, now = () => Date.now() }) {
  const get = async (req, res) => {
    const [profile] = await q(`SELECT ${COLS} FROM business_profile WHERE user_id=$1`, [req.uid]);
    if (!profile) return res.json({ ...goalProgress(null, { hasData: false }, now()), explanation: 'No goal yet. Set one in your business profile.' });
    const m = await pageMetrics(req.uid);
    let r = goalProgress(profile, m, now());
    if (r.needsBaseline) {
      // only fills an empty baseline, so two parallel requests cannot overwrite each other
      await q('UPDATE business_profile SET goal_baseline_value=$2 WHERE user_id=$1 AND goal_baseline_value IS NULL', [req.uid, r.currentValue]);
      const [again] = await q(`SELECT ${COLS} FROM business_profile WHERE user_id=$1`, [req.uid]);
      r = goalProgress(again, m, now());
    }
    const { needsBaseline, currentValue, ...out } = r;
    res.json({ ...out, secondary: profile.goal_secondary ?? null, updatedAt: new Date(now()).toISOString() });
  };
  return { get };
}
