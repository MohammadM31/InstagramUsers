# Phase 1 + 0.1b + 0.8 + 2.1 checks. Start the API (INLINE_WORKER=1 npm run dev, PORT=3055) after `npm run migrate && npm run seed`, then: bash scripts/smoke-phase1.sh
# Needs the seeded demo user. Prints what it sees; compare with the "expect" notes.
B=localhost:3055; J='content-type: application/json'
jget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
A=$(curl -s $B/api/auth/login -H "$J" -d '{"email":"demo@growthengine.ai","password":"demo1234"}' | jget "['token']"); H="Authorization: Bearer $A"
R=$(curl -s $B/api/auth/register -H "$J" -d '{"email":"p1'$RANDOM'@x.com","password":"password123","acceptTos":true}'); H2="Authorization: Bearer $(echo $R | jget "['token']")"
echo "== 1.1 /priorities (expect: list, every item has why + watch)"
curl -s $B/api/priorities -H "$H" | python3 -c "import sys,json;d=json.load(sys.stdin)['priorities'];print(len(d),'tips; missing why/watch:',[t['kind'] for t in d if not t.get('why') or not t.get('watch')]);print(d[0]['kind'],'|',d[0]['text'])"
echo "== 1.2 /ai/context (expect: keys coverage,gaps,health,metrics,sources; gaps mention demo data for the seeded user)"
curl -s $B/api/ai/context -H "$H" | python3 -c "import sys,json;d=json.load(sys.stdin);print(sorted(d));print(d['coverage']);[print(' -',s['name'],s['rows'],s['lastUpdated']) for s in d['sources']];[print(' gap:',g) for g in d['gaps']]"
echo "== 1.2 new user with no posts (expect: 'No posts yet' gap, no error)"
curl -s $B/api/ai/context -H "$H2" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['coverage'],d['gaps'])"
echo "== 1.4 /marketing/breakdown (expect: estimate true; every low-confidence row has a caveat)"
curl -s $B/api/marketing/breakdown -H "$H" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['estimate'],d['note']);[print(' ',c['share'],'%',c['name'],'|',c['confidence'],'|',c.get('caveat','')[:30]) for c in d['categories']]"
echo "== unauth (expect 401 x3)"; for p in priorities ai/context marketing/breakdown; do curl -s -o /dev/null -w "%{http_code} " $B/api/$p; done; echo
echo "== 0.1b refresh import: import, re-import with changed likes WITHOUT the flag, then WITH ?update=1"
P='[{"posted_at":"2026-10-04T10:00:00Z","type":"REEL","likes":5,"reach":100,"caption":"p1-refresh"}]'; P2='[{"posted_at":"2026-10-04T10:00:00Z","type":"REEL","likes":50,"reach":100,"caption":"p1-refresh"}]'
curl -s $B/api/import/posts -H "$H2" -H "$J" -d "$P"; echo "  <- expect imported 1"
curl -s $B/api/import/posts -H "$H2" -H "$J" -d "$P2"; echo "  <- expect imported 0, duplicates 1, updated 0 (likes stay 5)"
curl -s $B/api/posts -H "$H2" | python3 -c "import sys,json;print('likes now',[p['likes'] for p in json.load(sys.stdin)])"
curl -s "$B/api/import/posts?update=1" -H "$H2" -H "$J" -d "$P2"; echo "  <- expect imported 0, duplicates 1, updated 1"
curl -s "$B/api/import/posts?update=1" -H "$H2" -H "$J" -d "$P2"; echo "  <- expect updated 0 (nothing changed)"
curl -s $B/api/posts -H "$H2" | python3 -c "import sys,json;print('likes now',[p['likes'] for p in json.load(sys.stdin)])"
echo "== 2.1 snapshots (worker runs ~5s after boot, then hourly). Check in psql:"
echo "   SELECT count(*), count(DISTINCT post_id) FROM post_snapshots;   -- expect rows = posts, one per post per UTC day"
echo "   SELECT * FROM metrics_baseline;                                  -- expect one row per user that has posts"
echo "   (restart the worker and re-run: counts must NOT double on the same day)"
echo "== 0.8 assistant image is async (expect: no Replicate key -> type info; with a key -> type image + data.jobId, then poll)"
curl -s $B/api/assistant -H "$H" -H "$J" -d '{"message":"image of a coffee cup"}'; echo
