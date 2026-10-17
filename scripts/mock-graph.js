// Mock Graph API for smoke-phaseA1.sh. Serves the hand-written fixtures in test/fixtures/graph. Not a replica of Meta: it proves OUR code's
// request/response handling and SQL, never that Meta accepts our requests. Usage: node scripts/mock-graph.js [port]
import http from 'node:http';
import fs from 'node:fs';
const fx = n => JSON.parse(fs.readFileSync(new URL(`../test/fixtures/graph/${n}.json`, import.meta.url)));
const port = +process.argv[2] || 3099;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname.replace(/^\/v[\d.]+/, ''), q = u.searchParams;
  const send = (b, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  console.log(req.method, p, q.get('metric') || q.get('after') || '');
  if (p === '/oauth/access_token') {
    if (q.get('code') === 'BADCODE') return send(fx('error_declined_code'), 400);
    if (q.get('fb_exchange_token') === 'DEADTOKEN') return send(fx('error_190'), 400);
    return send(q.get('grant_type') === 'fb_exchange_token' ? { ...fx('oauth_long'), access_token: 'LONG_TOKEN_REFRESHED' } : fx('oauth_short'));
  }
  if (p === '/me/accounts') return send(q.get('access_token') === 'LONG_TOKEN' || q.get('access_token') === 'LONG_TOKEN_REFRESHED' || q.get('access_token') === 'SHORT_TOKEN' ? fx('me_accounts') : fx('error_190'), q.get('access_token') ? 200 : 400);
  if (p === '/me/permissions') return send(fx('permissions_all'));
  if (p === '/IG_1/media') return send(q.get('after') === 'CUR1' ? fx('media_page2') : fx('media_page1'));
  // ---- A.1c/A.1d account endpoints (hand-written; day values are generated relative to today) ----
  if (p === '/me' && q.get('fields') === 'id') return send({ id: 'FB_42' });
  if (p === '/IG_1' && /followers_count/.test(q.get('fields') || '')) return send({ followers_count: +(process.env.MOCK_FOLLOWERS || 1240), media_count: 87 });
  if (p === '/IG_1/insights') {
    const metric = q.get('metric') || '', day = 864e5, d0 = Date.parse(new Date().toISOString().slice(0, 10) + 'T07:00:00Z');
    if (metric === 'follower_count') return send({ data: [{ name: 'follower_count', period: 'day', values: Array.from({ length: 29 }, (_, i) => ({ value: i % 5 === 0 ? -1 : 3, end_time: new Date(d0 - (28 - i) * day).toISOString() })) }] });
    if (metric.startsWith('reach,views')) return send({ data: [{ name: 'reach', total_value: { value: 640 } }, { name: 'views', total_value: { value: 1900 } }, { name: 'accounts_engaged', total_value: { value: 55 } }, { name: 'profile_links_taps', total_value: { value: 4 } },
      { name: 'follows_and_unfollows', total_value: { breakdowns: [{ dimension_keys: ['follow_type'], results: [{ dimension_values: ['FOLLOWS'], value: 9 }, { dimension_values: ['UNFOLLOWS'], value: 3 }] }] } }] });
    if (metric === 'follower_demographics') return send({ data: [{ name: 'follower_demographics', total_value: { breakdowns: [{ dimension_keys: [q.get('breakdown')], results: [{ dimension_values: [q.get('breakdown') === 'age' ? '25-34' : 'US'], value: 300 }] }] } }] });
    if (metric === 'online_followers') return send({ data: [{ name: 'online_followers', values: [{ value: { 9: 40, 18: 120 }, end_time: new Date().toISOString() }] }] });
  }
  // ---- A.2 comments (fixture timestamps are shifted so the newest post is always "today": anchor 2026-10-14T14:30Z, just after the newest fixture comment) ----
  const cm = p.match(/^\/(\w+)\/comments$/);
  if (cm) {
    if (cm[1] === 'M_NOCOMMENTS') return send({ error: { message: 'mock: comments are turned off for this media', code: 100 } }, 400);
    const shift = Date.now() - Date.parse('2026-10-14T14:30:00Z');
    const moved = o => JSON.parse(JSON.stringify(o), (k, v) => (k === 'timestamp' && typeof v === 'string' && Date.parse(v) > Date.parse('2026-09-01') ? new Date(Date.parse(v) + shift).toISOString() : v));
    return send(cm[1] === 'M3' ? moved(fx(q.get('after') === 'CC1' ? 'comments_M3_p2' : 'comments_M3_p1')) : fx('comments_empty'));
  }
  const m = p.match(/^\/(\w+)\/insights$/);
  if (m) return send(m[1] === 'M3' ? fx('insights_reel') : m[1] === 'M2' ? fx('insights_feed') : fx('insights_core'));
  send({ error: { message: 'mock: unknown path ' + p, code: 100 } }, 404);
}).listen(port, () => console.log('mock graph on :' + port));
