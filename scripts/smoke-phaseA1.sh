# Roadmap A.1a/A.1b smoke. Runs the REAL server code and SQL against Postgres + Redis, with a MOCK Graph API (scripts/mock-graph.js).
# Proves our handling, SQL and flows. It does NOT prove Meta accepts our requests: that needs a real test account (A.0) and stays UNVERIFIED.
# WARNING: creates users in DATABASE_URL and edits ig_accounts rows. Dev/throwaway database only.
# Needs: psql, python3, redis-cli, a migrated DB. It starts its own server on :3055 and the mock on :3099, and stops both at the end.
# Run: DATABASE_URL=postgres://... bash scripts/smoke-phaseA1.sh        Compare each output with its "expect" note.
cd "$(dirname "$0")/.."; DB="${DATABASE_URL:?set DATABASE_URL}"; B=localhost:3055; J='content-type: application/json'
jget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
sql(){ psql "$DB" -tAc "$1"; }
node scripts/mock-graph.js 3099 >/tmp/mockgraph.log 2>&1 & MOCK=$!
PORT=3055 INLINE_WORKER=1 META_APP_ID=APP META_APP_SECRET=SECRET META_REDIRECT_URI=http://localhost:3055/api/instagram/connect/callback \
  META_GRAPH_BASE=http://localhost:3099 META_DIALOG_BASE=http://localhost:3099 node src/server.js >/tmp/server-a1.log 2>&1 & SRV=$!
trap 'kill $MOCK $SRV 2>/dev/null' EXIT; sleep 5
JOBENV="META_APP_ID=APP META_APP_SECRET=SECRET META_REDIRECT_URI=http://localhost:3055/api/instagram/connect/callback META_GRAPH_BASE=http://localhost:3099" # the one-liners below run the refresh job in their own process
reg(){ curl -s $B/api/auth/register -H "$J" -d '{"email":"a1'$RANDOM$RANDOM'@x.com","password":"password123","acceptTos":true}' | jget "['token']"; }
TA=$(reg); HA="Authorization: Bearer $TA"; UA=$(sql "SELECT id FROM users ORDER BY created_at DESC LIMIT 1")
callback(){ curl -s -o /dev/null -w '%{redirect_url}' "$B/api/instagram/connect/callback?$1"; }
startstate(){ curl -s $B/api/instagram/connect/start -H "$2" | jget "['url']" | sed -E 's/.*state=([0-9a-f]+).*/\1/'; }
poll(){ for i in $(seq 1 30); do r=$(curl -s $B/api/instagram/sync/$1 -H "$2"); case "$r" in *pending*) sleep 0.5;; *) echo "$r"; return;; esac; done; echo timeout; }

echo "== no token: every authenticated route 401, callback is public (expect 401 401 401 then a redirect with reason=state_invalid)"
for p in status connect/start sync; do curl -s -o /dev/null -w '%{http_code} ' $B/api/instagram/$p; done; echo
callback "code=C&state=nope"; echo
echo "== status before connecting (expect connected False, status not_connected or dev_env, configured True)"
curl -s $B/api/instagram/status -H "$HA"; echo
echo "== start (expect a URL on the dialog host with scope, state of 48 hex chars)"
SA=$(startstate x "$HA"); echo "state length: ${#SA}"; curl -s $B/api/instagram/connect/start -H "$HA" | jget "['url']" | cut -c1-230
echo "== callback with a bad code (expect reason=token_error, no ig_accounts row)"
SB=$(startstate x "$HA"); callback "code=BADCODE&state=$SB"; echo; sql "SELECT count(*) FROM ig_accounts WHERE user_id='$UA'"
echo "== user declines (expect reason=declined)"; SC=$(startstate x "$HA"); callback "error=access_denied&state=$SC"; echo
echo "== callback success (expect ig=connected), replay of the same state (expect state_invalid)"
callback "code=GOOD&state=$SA"; echo; callback "code=GOOD&state=$SA"; echo
echo "== status (expect connected True, username studio.example, daysLeft 59 or 60, NO token anywhere)"
S=$(curl -s $B/api/instagram/status -H "$HA"); echo "$S" | cut -c1-300; echo "$S" | grep -c TOKEN
echo "== stored token is encrypted (expect: ciphertext does not contain LONG_TOKEN -> 0)"
sql "SELECT count(*) FROM api_keys WHERE user_id='$UA' AND name='instagram' AND enc LIKE '%LONG_TOKEN%'"
echo "== sync now (expect 202, then done: fetched 3 inserted 3 updated 0 linked 0)"
J1=$(curl -s -X POST $B/api/instagram/sync -H "$HA" | jget "['jobId']"); poll $J1 "$HA"
echo "== immediate second sync (expect 429 cooldown with Retry-After)"
curl -s -i -X POST $B/api/instagram/sync -H "$HA" | grep -iE '^HTTP|retry-after|error' | tr -d '\r'
echo "== posts (expect 3 rows with ig_media_id; reel M3 reach 5000 views 7200 watch_s 5; M1 carousel reach 900 views NULL; no story)"
sql "SELECT ig_media_id,type,likes,comments,reach,views,saves,shares,watch_s,permalink IS NOT NULL FROM posts WHERE user_id='$UA' ORDER BY ig_media_id"
echo "== ig_accounts bookkeeping (expect last_sync_at set, last_error empty)"
sql "SELECT last_sync_at IS NOT NULL, coalesce(last_error,'') FROM ig_accounts WHERE user_id='$UA'"
echo "== snapshots ran after sync (expect 3)"; sql "SELECT count(*) FROM post_snapshots s JOIN posts p ON p.id=s.post_id WHERE p.user_id='$UA'"
echo "== re-sync after clearing the cooldown (expect inserted 0, still 3 posts)"
redis-cli del "rl:igsync:$UA" >/dev/null; J2=$(curl -s -X POST $B/api/instagram/sync -H "$HA" | jget "['jobId']"); poll $J2 "$HA"; sql "SELECT count(*) FROM posts WHERE user_id='$UA'"
echo "== job isolation: another user polling this job (expect 404)"
TB=$(reg); HB="Authorization: Bearer $TB"; UB=$(sql "SELECT id FROM users ORDER BY created_at DESC LIMIT 1"); curl -s -o /dev/null -w '%{http_code}\n' $B/api/instagram/sync/$J1 -H "$HB"
echo "== sync before connecting (expect 409)"; curl -s -w ' %{http_code}\n' -X POST $B/api/instagram/sync -H "$HB"

echo "== CSV row first, then connect + sync (expect linked 1, ONE 'Fresh batch' row carrying ig_media_id M2 and the API numbers)"
curl -s -X POST $B/api/import/posts -H "$HB" -H 'content-type: text/csv' --data-binary $'date,type,caption,likes,comments,saves,shares,reach\n2026-10-13,IMAGE,Fresh batch,70,3,9,2,1800\n' | cut -c1-120; echo
SD=$(startstate x "$HB"); callback "code=GOOD&state=$SD" >/dev/null
J3=$(curl -s -X POST $B/api/instagram/sync -H "$HB" | jget "['jobId']"); poll $J3 "$HB"
sql "SELECT count(*), max(ig_media_id), max(reach), max(likes) FROM posts WHERE user_id='$UB' AND caption='Fresh batch'"
echo "== partial unique index: no duplicate (user, ig_media_id) (expect 0 rows)"
sql "SELECT user_id,ig_media_id,count(*) FROM posts WHERE ig_media_id IS NOT NULL GROUP BY 1,2 HAVING count(*)>1"

echo "== token health: 5 days left -> refresh job swaps the token and pushes expiry out (expect refreshed 1, daysLeft ~59-60)"
sql "UPDATE ig_accounts SET token_expires_at=now()+interval '5 days' WHERE user_id='$UA'" >/dev/null
env $JOBENV node -e "import('./src/loadenv.js').then(()=>import('./src/igwire.js')).then(async m=>{console.log(JSON.stringify(await m.igConnect.refreshTokens()));process.exit(0)})" 2>&1 | tail -1
curl -s $B/api/instagram/status -H "$HA" | jget "['daysLeft']"
echo "== token expired -> reconnect_needed + one notification, sync refused, env/other credentials NOT used (expect status reconnect_needed, 1 notification, 409)"
sql "UPDATE ig_accounts SET token_expires_at=now()-interval '1 day' WHERE user_id='$UA'" >/dev/null
env $JOBENV node -e "import('./src/loadenv.js').then(()=>import('./src/igwire.js')).then(async m=>{console.log(JSON.stringify(await m.igConnect.refreshTokens()));console.log(JSON.stringify(await m.igConnect.refreshTokens()));process.exit(0)})" 2>&1 | tail -2
curl -s $B/api/instagram/status -H "$HA" | jget "['status']"
curl -s $B/api/notifications -H "$HA" | python3 -c "import sys,json;d=json.load(sys.stdin);print([i['kind'] for i in d['items']])"
redis-cli del "rl:igsync:$UA" >/dev/null; curl -s -w ' %{http_code}\n' -X POST $B/api/instagram/sync -H "$HA"
echo "== reconnect heals it (expect ig=connected, status connected)"
SE=$(startstate x "$HA"); callback "code=GOOD&state=$SE"; echo; curl -s $B/api/instagram/status -H "$HA" | jget "['status']"

echo "== GDPR export lists ig_accounts without any token (expect True, then 0)"
G=$(curl -s $B/api/gdpr/export -H "$HA"); echo "$G" | python3 -c "import sys,json;d=json.load(sys.stdin);print('ig_accounts' in d, len(d['ig_accounts']))"; echo "$G" | grep -c 'LONG_TOKEN'
echo "== disconnect keep (expect postsDeleted 0, status disconnected, posts still 3)"
curl -s -X DELETE "$B/api/instagram/disconnect?data=keep" -H "$HA"; echo; curl -s $B/api/instagram/status -H "$HA" | jget "['status']"; sql "SELECT count(*) FROM posts WHERE user_id='$UA'"
echo "== token gone after disconnect (expect 0)"; sql "SELECT count(*) FROM api_keys WHERE user_id='$UA' AND name='instagram'"
echo "== disconnect with bad value (expect 400), then delete (expect postsDeleted 3, 0 left)"
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$B/api/instagram/disconnect?data=nuke" -H "$HA"
curl -s -X DELETE "$B/api/instagram/disconnect?data=delete" -H "$HA"; echo; sql "SELECT count(*) FROM posts WHERE user_id='$UA'"
echo "== account delete cascades (expect 0 0)"
curl -s -X DELETE $B/api/gdpr/account -H "$HA" >/dev/null; sql "SELECT (SELECT count(*) FROM ig_accounts WHERE user_id='$UA'),(SELECT count(*) FROM api_keys WHERE user_id='$UA')"
echo "== not configured server: start gives a clear 503 (expect 503 with META_APP_ID in the message) -- checked in unit tests; the server above IS configured"
echo "== mock graph saw these paths:"; sort /tmp/mockgraph.log | uniq -c | sort -rn | head -12
