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
  const m = p.match(/^\/(\w+)\/insights$/);
  if (m) return send(m[1] === 'M3' ? fx('insights_reel') : m[1] === 'M2' ? fx('insights_feed') : fx('insights_core'));
  send({ error: { message: 'mock: unknown path ' + p, code: 100 } }, 404);
}).listen(port, () => console.log('mock graph on :' + port));
