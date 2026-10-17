# Roadmap A.2 smoke (comments). Runs the REAL server code and SQL against Postgres + Redis, with the MOCK Graph API (scripts/mock-graph.js, hand-written fixtures).
# Proves our handling, SQL and flows. It does NOT prove Meta returns this shape or accepts our request: that needs a real test account (A.0) and stays UNVERIFIED.
# WARNING: creates users in DATABASE_URL, edits ig_accounts / post_comments rows. Dev/throwaway database only.
# Needs: psql, python3, redis-cli, a migrated DB (npm run migrate). Starts its own server on :3055 and the mock on :3099 and stops both at the end.
# Run alone (the API allows 120 requests/minute per IP). Run: DATABASE_URL=postgres://... bash scripts/smoke-phaseA2.sh      Compare each output with its "expect" note.
# NOTE: written in session 11 with NO Postgres/Redis/pg driver available, so it has only been syntax-checked (bash -n). Its first real run is still to do.
cd "$(dirname "$0")/.."; DB="${DATABASE_URL:?set DATABASE_URL}"; B=localhost:3055; J='content-type: application/json'
jget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
show(){ python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
sql(){ psql "$DB" -tAc "$1"; }
code(){ curl -s -o /tmp/a2.json -w '%{http_code} ' "$@"; }
node scripts/mock-graph.js 3099 >/tmp/mockgraph-a2.log 2>&1 & MOCK=$!
ENVV="META_APP_ID=APP META_APP_SECRET=SECRET META_REDIRECT_URI=http://localhost:3055/api/instagram/connect/callback META_GRAPH_BASE=http://localhost:3099 META_DIALOG_BASE=http://localhost:3099"
env $ENVV PORT=3055 INLINE_WORKER=1 node src/server.js >/tmp/server-a2.log 2>&1 & SRV=$!
trap 'kill $MOCK $SRV 2>/dev/null' EXIT; sleep 5
reg(){ curl -s $B/api/auth/register -H "$J" -d '{"email":"'$1'","password":"password123","acceptTos":true}' | jget "['token']"; }
poll(){ for i in $(seq 1 30); do r=$(curl -s $B/api/instagram/sync/$1 -H "$2"); case "$r" in *pending*) sleep 0.5;; *) echo "$r"; return;; esac; done; echo timeout; }
EA="a2a$RANDOM$RANDOM@x.com"; EB="a2b$RANDOM$RANDOM@x.com"
HA="Authorization: Bearer $(reg $EA)"; HB="Authorization: Bearer $(reg $EB)"
UA=$(sql "SELECT id FROM users WHERE email='$EA'")
# connect A through the mock OAuth, then sync (3 posts: M3 reel, M2 image, M1 carousel; the story is skipped)
ST=$(curl -s $B/api/instagram/connect/start -H "$HA" | jget "['url']" | sed -E 's/.*state=([0-9a-f]+).*/\1/')
curl -s -o /dev/null "$B/api/instagram/connect/callback?code=GOOD&state=$ST"
J1=$(curl -s -X POST $B/api/instagram/sync -H "$HA" | jget "['jobId']"); poll $J1 "$HA" | cut -c1-120
M3=$(sql "SELECT id FROM posts WHERE user_id='$UA' AND ig_media_id='M3'"); M2=$(sql "SELECT id FROM posts WHERE user_id='$UA' AND ig_media_id='M2'")

# the post fixtures have fixed dates; make M3 "5 hours old" so the 24 h question alert can apply (the mock shifts comment times so the newest is 30 min ago)
sql "UPDATE posts SET posted_at=now()-interval '5 hours' WHERE id=$M3" >/dev/null

echo "== no token (expect 401), bad id (expect 400), unknown id (expect 404)"
curl -s -o /dev/null -w '%{http_code} ' $B/api/posts/$M3/comments; code $B/api/posts/abc/comments -H "$HA"; code $B/api/posts/999999999/comments -H "$HA"; echo
echo "== before any pull (expect total 0, reason none_stored, connected True)"
curl -s $B/api/posts/$M3/comments -H "$HA" | show "print('  total',d['insights']['total'],'| reason',d['reason'],'| connected',d['connected'])"

echo "== pull comments with the same code the worker runs (needs the app env so getIgCreds works; expect JSON with comments 6 and no failures)"
env $ENVV node --input-type=module -e "
import('./src/igwire.js').then(async m=>{const r=await m.comments.runAll();console.log(JSON.stringify(r));process.exit(0)})"
echo "== stored rows for M3 (expect 6: C1 C2 C3 C5 C6 C7; NOT C4 the owner, NOT C8 older than 90 days, NOT C9 blank)"
sql "SELECT string_agg(ig_comment_id,' ' ORDER BY ig_comment_id) FROM post_comments WHERE user_id='$UA' AND post_id=$M3"
echo "== owner_replied (expect C3 true only)"; sql "SELECT string_agg(ig_comment_id,' ' ORDER BY ig_comment_id) FROM post_comments WHERE user_id='$UA' AND owner_replied"
echo "== second pull changes nothing (expect 6 again, no duplicates)"
env $ENVV node --input-type=module -e "import('./src/igwire.js').then(async m=>{await m.comments.runAll();process.exit(0)})"
sql "SELECT count(*), count(DISTINCT ig_comment_id) FROM post_comments WHERE user_id='$UA'"

echo "== endpoint (expect total 6, sentimentIsEstimate True, questions total 4 unanswered 3, an openQuestions-style list with C2 C6 C7, 6 comments, no ig_comment_id key)"
curl -s $B/api/posts/$M3/comments -H "$HA" | show "i=d['insights'];print('  total',i['total'],'| estimate',i['sentimentIsEstimate'],'| sentiment',i['sentiment'],'| questions',i['questions']);print('  unanswered:',[c['text'] for c in d['comments'] if c['question'] and not c['owner_replied']]);print('  keys',sorted(d['comments'][0].keys()));print('  top',i['topCommenters'][:2],'| themes',i['themes']);print('  lastFetchedAt set:',bool(d['lastFetchedAt']))"
echo "== post without comments (expect total 0, reason none_stored)"
curl -s $B/api/posts/$M2/comments -H "$HA" | show "print('  total',d['insights']['total'],'| reason',d['reason'])"
echo "== user B cannot read A's post comments (expect 404)"; code $B/api/posts/$M3/comments -H "$HB"; echo

echo "== notification: M3 is under 24 h old in the mock and has 3 unanswered questions (expect exactly 1 'questions' notification with dedupe key questions:$M3 after two runs)"
sql "SELECT kind, title, dedupe_key FROM notifications WHERE user_id='$UA' AND kind='questions'"
echo "== answering one question removes the alert condition for NEW runs but never re-creates or duplicates (expect still 1 row after another run)"
sql "UPDATE post_comments SET owner_replied=true WHERE user_id='$UA' AND ig_comment_id='C2'"
env $ENVV node --input-type=module -e "import('./src/igwire.js').then(async m=>{await m.comments.runAll();process.exit(0)})"
sql "SELECT count(*) FROM notifications WHERE user_id='$UA' AND kind='questions'"
echo "== a re-pull does not un-answer C2 locally set to replied (expect true): owner_replied is never reset by a pull"
sql "SELECT owner_replied FROM post_comments WHERE user_id='$UA' AND ig_comment_id='C2'"

echo "== retention: age one comment past 90 days and run the job (expect it deleted, the others kept = 5)"
sql "UPDATE post_comments SET posted_at=now()-interval '91 days' WHERE user_id='$UA' AND ig_comment_id='C1'"
env $ENVV node --input-type=module -e "import('./src/igwire.js').then(async m=>{console.log(JSON.stringify({deleted:await m.comments.retention()}));process.exit(0)})"
sql "SELECT count(*) FROM post_comments WHERE user_id='$UA' AND post_id=$M3"

echo "== GDPR export lists post_comments (expect True and rows 5)"
curl -s $B/api/gdpr/export -H "$HA" | show "print(' ', 'post_comments' in d, len(d['post_comments']))"
echo "== disconnect with data=delete removes the Instagram posts and, by cascade, their comments (expect 0 comments)"
code -X DELETE "$B/api/instagram/disconnect?data=delete" -H "$HA"; echo; sql "SELECT count(*) FROM post_comments WHERE user_id='$UA'"
echo "== account delete cascade (expect 0)"
code -X DELETE $B/api/gdpr/account -H "$HA"; echo; sql "SELECT count(*) FROM post_comments WHERE user_id='$UA'"
