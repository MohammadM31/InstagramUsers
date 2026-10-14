# WARNING: this script edits the DEMO user's baseline and notifications in DATABASE_URL. Run it on a throwaway/dev database only, never on production.
# Checks for roadmap 2.2 (per-post analysis) and 2.3 (notifications). Needs: API on :3055 (INLINE_WORKER=1 npm run dev), a migrated + seeded
# database, psql, and DATABASE_URL in the environment (it is used to rewind the baseline so alerts can be triggered without waiting days).
# Compare each output with its "expect" note.  Run: DATABASE_URL=postgres://... bash scripts/smoke-phase2.sh
B=localhost:3055; J='content-type: application/json'; DB="${DATABASE_URL:?set DATABASE_URL}"
jget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
sql(){ psql "$DB" -tAc "$1"; }
job(){ node -e "import('./src/loadenv.js').then(()=>Promise.all([import('./src/db.js'),import('./src/notifications.js')])).then(async([d,n])=>{console.log(JSON.stringify(await n.runNotifications(d.q)));await d.db.end()})"; }
login(){ curl -s $B/api/auth/login -H "$J" -d '{"email":"demo@growthengine.ai","password":"demo1234"}' | jget "['token']"; }
H="Authorization: Bearer $(login)"
R=$(curl -s $B/api/auth/register -H "$J" -d '{"email":"p2'$RANDOM'@x.com","password":"password123","acceptTos":true}'); H2="Authorization: Bearer $(echo $R | jget "['token']")"
UID_=$(sql "SELECT id FROM users WHERE email='demo@growthengine.ai'")
PID=$(curl -s $B/api/posts -H "$H" | jget "[0]['id']")

echo "== 2.2 analysis (expect: text with engagement rate + 'does not show what caused them', rank, delta null with 1 day of snapshots)"
curl -s $B/api/posts/$PID/analysis -H "$H" | python3 -c "import sys,json;d=json.load(sys.stdin);print(' ',d['text']);print('  rank',d['rank'],'| delta',d['delta'],'| snapshots',d['snapshots'])"
echo "== 2.2 ownership and validation (expect 404 400 401)"
for u in "/posts/$PID/analysis -H '$H2'" "/posts/abc/analysis -H '$H'" "/posts/$PID/analysis"; do eval curl -s -o /dev/null -w '"%{http_code} "' "$B/api$u"; done; echo
echo "== 2.2 trend: add an older snapshot (2 days back, lower reach) -> expect delta with days 2, positive reach pct"
sql "INSERT INTO post_snapshots(post_id,captured_at,likes,comments,saves,shares,reach) SELECT id, now()-interval '2 days', likes/2, comments/2, saves/2, shares/2, reach/2 FROM posts WHERE id=$PID ON CONFLICT DO NOTHING" >/dev/null
curl -s $B/api/posts/$PID/analysis -H "$H" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  delta days',d['delta']['days'],'reach',d['delta']['reach'],'er',d['delta']['er']);print(' ',d['text'][-200:])"

echo "== 2.3 day one: baseline exists, current equals baseline (expect created 0, empty list)"
sql "UPDATE metrics_baseline SET ahead=NULL WHERE user_id='$UID_'" >/dev/null
sql "DELETE FROM notifications WHERE user_id='$UID_'" >/dev/null
job; curl -s $B/api/notifications -H "$H"; echo
echo "== 2.3 force a drop: baseline reach x3, ER +5 points, best post halved (expect created 3: reach_drop, er_drop, best_post)"
sql "UPDATE metrics_baseline SET reach30d=reach30d*3, er=er+5, best_post_er=best_post_er/2 WHERE user_id='$UID_'" >/dev/null
job
echo "== 2.3 run again (expect created 0: deduplicated, best_post stored)"; job
curl -s $B/api/notifications -H "$H" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  unread',d['unread']);[print('  -',n['kind'],'|',n['title'],'| watch:',n['watch']) for n in d['items']]"

echo "== 2.3 competitor alert: real-looking source, rival with huge likes (expect 1 alert for @rival-ish handle; none while source is 'demo')"
CID=$(sql "SELECT id FROM competitors WHERE user_id='$UID_' ORDER BY id LIMIT 1")
curl -s -o /dev/null -X POST $B/api/scrape/$CID -H "$H"; sleep 4
sql "UPDATE competitor_posts SET likes=99999, comments=999, posted_at=now()-interval '1 day' WHERE competitor_id=$CID" >/dev/null
sql "UPDATE metrics_baseline SET ahead='{}' WHERE user_id='$UID_'" >/dev/null
echo -n "  demo source: "; job
sql "UPDATE scrape_audit SET source='business_discovery' WHERE user_id='$UID_'" >/dev/null
echo -n "  real source: "; job; echo -n "  again:       "; job
sql "UPDATE scrape_audit SET source='demo' WHERE user_id='$UID_'" >/dev/null

echo "== 2.3 API: mark read, scoping, dismiss (expect unread drops by 1; other user gets 404 404; then gone)"
NID=$(curl -s $B/api/notifications -H "$H" | jget "['items'][0]['id']")
curl -s -X PATCH $B/api/notifications/$NID -H "$H" -H "$J" -d '{"read":true}'; echo
curl -s $B/api/notifications -H "$H" | jget "['unread']"
for m in PATCH DELETE; do curl -s -o /dev/null -w "$m other user %{http_code}  " -X $m $B/api/notifications/$NID -H "$H2" -H "$J" -d '{}'; done; echo
curl -s $B/api/notifications -H "$H2"; echo "  <- expect unread 0, no items for the other user"
curl -s -X PATCH $B/api/notifications/read-all -H "$H"; echo "  <- expect ok"
curl -s -o /dev/null -w "bad id %{http_code}  " -X PATCH $B/api/notifications/abc -H "$H" -H "$J" -d '{}'
curl -s -o /dev/null -w "no token %{http_code}\n" $B/api/notifications
curl -s -X DELETE $B/api/notifications/$NID -H "$H"; echo
curl -s $B/api/notifications -H "$H" | jget "['unread'],len(d['items'])"; echo "  <- expect unread 0 and one fewer item"
echo "== GDPR export includes notifications"; curl -s $B/api/gdpr/export -H "$H" | python3 -c "import sys,json;d=json.load(sys.stdin);print(' ','notifications' in d,len(d['notifications']))"
