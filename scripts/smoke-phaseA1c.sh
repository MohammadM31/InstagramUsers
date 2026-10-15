# Roadmap A.1c (follower history, account insights) + A.1d backend (Meta callbacks, privacy page, persisted Dismiss) smoke.
# Runs the REAL server code and SQL against Postgres + Redis, with a MOCK Graph API (scripts/mock-graph.js, hand-written responses).
# Proves our handling, SQL and flows. It does NOT prove Meta returns these shapes: follows_and_unfollows labels, the follower_count day mapping,
# audience responses and since/until boundaries stay UNVERIFIED until a real test account (A.0).
# WARNING: creates users in DATABASE_URL and edits ig_accounts rows. Dev/throwaway database only.
# Needs: psql, python3, redis-cli, a migrated DB. Starts its own server on :3056 and the mock on :3098, stops both at the end.
# Run: DATABASE_URL=postgres://... bash scripts/smoke-phaseA1c.sh        Compare each output with its "expect" note.
cd "$(dirname "$0")/.."; DB="${DATABASE_URL:?set DATABASE_URL}"; B=localhost:3056; J='content-type: application/json'
jget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
sql(){ psql "$DB" -tAc "$1"; }
node scripts/mock-graph.js 3098 >/tmp/mockgraph-c.log 2>&1 & MOCK=$!
PORT=3056 INLINE_WORKER=1 META_APP_ID=APP META_APP_SECRET=SECRET META_REDIRECT_URI=http://localhost:3056/api/instagram/connect/callback \
  META_GRAPH_BASE=http://localhost:3098 META_DIALOG_BASE=http://localhost:3098 PRIVACY_OPERATOR="Test Co" PRIVACY_CONTACT_EMAIL=p@test.example node src/server.js >/tmp/server-c.log 2>&1 & SRV=$!
trap 'kill $MOCK $SRV 2>/dev/null' EXIT; sleep 5
reg(){ curl -s $B/api/auth/register -H "$J" -d '{"email":"a1c'$RANDOM$RANDOM'@x.com","password":"password123","acceptTos":true}' | jget "['token']"; }
signed(){ python3 - "$1" "$2" <<'PY'
import sys,json,hmac,hashlib,base64
b=lambda x:base64.urlsafe_b64encode(x).rstrip(b'=').decode()
p=b(json.dumps({'algorithm':sys.argv[2] if len(sys.argv)>2 else 'HMAC-SHA256','user_id':sys.argv[1]}).encode())
print(b(hmac.new(b'SECRET',p.encode(),hashlib.sha256).digest())+'.'+p)
PY
}
poll(){ for i in $(seq 1 30); do r=$(curl -s $B/api/instagram/sync/$1 -H "$2"); case "$r" in *pending*) sleep 0.5;; *) echo "$r"; return;; esac; done; echo timeout; }
connect(){ S=$(curl -s $B/api/instagram/connect/start -H "$1" | jget "['url']" | sed -E 's/.*state=([0-9a-f]+).*/\1/'); curl -s -o /dev/null -w '%{redirect_url}' "$B/api/instagram/connect/callback?code=GOOD&state=$S"; }
TA=$(reg); HA="Authorization: Bearer $TA"; UA=$(sql "SELECT id FROM users ORDER BY created_at DESC LIMIT 1")

echo "== connect (expect ig=connected) and the Facebook id stored on the account (expect FB_42)"
connect "$HA"; echo; sql "SELECT fb_user_id FROM ig_accounts WHERE user_id='$UA'"
echo "== first sync (expect done, account.followers 1240, history 31)"
J1=$(curl -s -X POST $B/api/instagram/sync -H "$HA" | jget "['jobId']"); poll $J1 "$HA"
echo "== follower_history (expect 30 reconstructed + 1 live = 31 rows, one per UTC day; today's row is live with 1240)"
sql "SELECT count(*), count(*) FILTER (WHERE source='reconstructed'), count(*) FILTER (WHERE source='live') FROM follower_history WHERE user_id='$UA'"
sql "SELECT followers FROM follower_history WHERE user_id='$UA' AND source='live'"
echo "== account daily (expect 2 rows with reach 640 views 1900 engaged 55 taps 4 follows 9 unfollows 3) and 1 audience snapshot"
sql "SELECT count(*), min(reach), min(views), min(accounts_engaged), min(profile_links_taps), min(follows), min(unfollows) FROM ig_account_daily WHERE user_id='$UA'"
sql "SELECT count(*) FROM ig_audience WHERE user_id='$UA'"
echo "== last_error empty (account part had no warnings)"; sql "SELECT coalesce(last_error,'') FROM ig_accounts WHERE user_id='$UA'"
echo "== re-sync after clearing the cooldown (expect no new reconstructed rows, still 1 live row today, still 1 audience snapshot)"
redis-cli del "rl:igsync:$UA" >/dev/null; J2=$(curl -s -X POST $B/api/instagram/sync -H "$HA" | jget "['jobId']"); poll $J2 "$HA" >/dev/null
sql "SELECT count(*) FROM follower_history WHERE user_id='$UA'"; sql "SELECT count(*) FROM ig_audience WHERE user_id='$UA'"
echo "== status (expect followers 1240, followerPoints 31, followerSource live)"
curl -s $B/api/instagram/status -H "$HA" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['followers'],d['followerPoints'],d['followerSource'])"
echo "== advisor uses followers: /ai/context metrics.followerSeries has points; last gap says growth is follower count"
curl -s $B/api/ai/context -H "$HA" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d['metrics']['followerSeries']), d['gaps'][-1])"
echo "== forced follower drop (expect a follower_drop tip first)"
sql "UPDATE follower_history SET followers=followers+200 WHERE user_id='$UA' AND source='reconstructed' AND captured_at>now()-interval '8 days'"
curl -s $B/api/priorities -H "$HA" | python3 -c "import sys,json;d=json.load(sys.stdin);print([t['kind'] for t in d['priorities']][:3])"

echo "== dismiss: 14 days by default (expect the collab or mention tip gone, snoozed lists it, until about 14 days ahead)"
K=$(curl -s $B/api/priorities -H "$HA" | jget "['priorities'][1]['kind']"); echo "dismissing $K"
curl -s -X POST $B/api/priorities/$K/dismiss -H "$HA" -H "$J" -d '{}'; echo
curl -s $B/api/priorities -H "$HA" | python3 -c "import sys,json;d=json.load(sys.stdin);print('$K' in [t['kind'] for t in d['priorities']], [s['key'] for s in d['snoozed']])"
echo "== bad days / bad key (expect 400 400 400)"
for body in '{"days":0}' '{"days":366}' '{"days":"x"}'; do curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/priorities/$K/dismiss -H "$HA" -H "$J" -d "$body"; done; echo
echo "== undo (expect the tip is back, snoozed empty)"; curl -s -X DELETE $B/api/priorities/$K -H "$HA"; echo
curl -s $B/api/priorities -H "$HA" | python3 -c "import sys,json;d=json.load(sys.stdin);print('$K' in [t['kind'] for t in d['priorities']], d['snoozed'])"
echo "== another user's dismissals are separate (expect True: the tip is still listed for user B)"
TB=$(reg); HB="Authorization: Bearer $TB"; curl -s -X POST $B/api/priorities/start/dismiss -H "$HA" -H "$J" -d '{}' >/dev/null
curl -s $B/api/priorities -H "$HB" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['snoozed']==[], len(d['priorities'])>0)"

echo "== privacy page is public (expect 200, no DRAFT banner because the operator is set, contains Test Co)"
curl -s -w ' %{http_code}\n' $B/privacy | grep -oE "Test Co|DRAFT|[0-9]{3}$" | sort -u | tr '\n' ' '; echo
echo "== deauthorize: bad signature (expect 400), wrong algorithm (expect 400), good signature (expect {ok:true}, status disconnected, token gone, data kept)"
curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/instagram/deauthorize -d "signed_request=abc.def"
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/api/instagram/deauthorize --data-urlencode "signed_request=$(signed FB_42 none)"
curl -s -X POST $B/api/instagram/deauthorize --data-urlencode "signed_request=$(signed FB_42)"; echo
sql "SELECT status FROM ig_accounts WHERE user_id='$UA'"; sql "SELECT count(*) FROM api_keys WHERE user_id='$UA' AND name='instagram'"; sql "SELECT count(*) FROM follower_history WHERE user_id='$UA'"
echo "== reconnect, then data-deletion (expect JSON with url + confirmation_code; account, posts with ig_media_id, follower_history, daily, audience all 0)"
connect "$HA" >/dev/null
R=$(curl -s -X POST $B/api/instagram/data-deletion --data-urlencode "signed_request=$(signed FB_42)"); echo "$R"; CODE=$(echo "$R" | jget "['confirmation_code']")
sql "SELECT (SELECT count(*) FROM ig_accounts WHERE user_id='$UA'),(SELECT count(*) FROM posts WHERE user_id='$UA' AND ig_media_id IS NOT NULL),(SELECT count(*) FROM follower_history WHERE user_id='$UA'),(SELECT count(*) FROM ig_account_daily WHERE user_id='$UA'),(SELECT count(*) FROM ig_audience WHERE user_id='$UA')"
echo "== only a hash is stored (expect a 64-char hash and 0 rows containing FB_42)"
sql "SELECT length(fb_hash) FROM ig_deletion_requests WHERE code='$CODE'"; sql "SELECT count(*) FROM ig_deletion_requests WHERE fb_hash LIKE '%FB_42%' OR detail LIKE '%FB_42%'"
echo "== status page (expect 200 and 'completed'), unknown code (expect 404), injection attempt (expect 404)"
curl -s -w ' %{http_code}\n' "$B/api/instagram/deletion-status?code=$CODE" | grep -oE "completed|[0-9]{3}$" | sort -u | tr '\n' ' '; echo
curl -s -o /dev/null -w '%{http_code} ' "$B/api/instagram/deletion-status?code=000000000000000000000000"; curl -s -o /dev/null -w '%{http_code}\n' "$B/api/instagram/deletion-status?code=1'%20OR%201=1"
echo "== unknown Facebook id still answers and says nothing was stored (expect a code and 'No Instagram data')"
R2=$(curl -s -X POST $B/api/instagram/data-deletion --data-urlencode "signed_request=$(signed NOBODY)"); C2=$(echo "$R2" | jget "['confirmation_code']"); sql "SELECT detail FROM ig_deletion_requests WHERE code='$C2'"

echo "== disconnect with data=delete clears the A.1c tables (expect accountRowsDeleted > 0 for a connected, synced user)"
TC=$(reg); HC="Authorization: Bearer $TC"; UC=$(sql "SELECT id FROM users ORDER BY created_at DESC LIMIT 1"); connect "$HC" >/dev/null
JC=$(curl -s -X POST $B/api/instagram/sync -H "$HC" | jget "['jobId']"); poll $JC "$HC" >/dev/null
curl -s -X DELETE "$B/api/instagram/disconnect?data=delete" -H "$HC"; echo
echo "== GDPR export lists the new tables (expect follower_history ig_account_daily ig_audience priority_dismissals) and no token"
curl -s $B/api/gdpr/export -H "$HA" | python3 -c "import sys,json;d=json.load(sys.stdin);print([k for k in d if k in ('follower_history','ig_account_daily','ig_audience','priority_dismissals')], 'LONG_TOKEN' in json.dumps(d))"
echo "== account delete cascades (expect 0 0 0 0)"
curl -s -X DELETE $B/api/gdpr/account -H "$HB" >/dev/null; curl -s -X DELETE $B/api/gdpr/account -H "$HA" >/dev/null
sql "SELECT (SELECT count(*) FROM follower_history WHERE user_id='$UA'),(SELECT count(*) FROM ig_account_daily WHERE user_id='$UA'),(SELECT count(*) FROM ig_audience WHERE user_id='$UA'),(SELECT count(*) FROM priority_dismissals WHERE user_id='$UA')"
