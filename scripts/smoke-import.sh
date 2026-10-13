# Usage: start the API (npm run dev, PORT=3055 or edit B), seed the demo user, then: bash scripts/smoke-import.sh
B=localhost:3055; J='content-type: application/json'
jget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
A=$(curl -s $B/api/auth/login -H "$J" -d '{"email":"demo@growthengine.ai","password":"demo1234"}' | jget "['token']")
R=$(curl -s $B/api/auth/register -H "$J" -d '{"email":"other'$RANDOM'@x.com","password":"password123","acceptTos":true}'); B2=$(echo $R | jget "['token']")
echo "A status:"; curl -s $B/api/import/status -H "Authorization: Bearer $A"; echo
cat > /tmp/ge-posts.csv <<'EOF'
Date,Media Type,Likes,Comments,Saves,Shares,Reach,Caption
2026-10-01T10:00:00Z,Reel,"1,200",40,30,12,9000,"Launch day, big news"
2026-10-02T12:00:00Z,Photo,300,10,5,2,2500,Behind the scenes
2026-10-03T09:00:00Z,Carousel,450,22,41,9,3100,Tips carousel
not-a-date,Reel,1,1,1,1,1,bad row
EOF
echo "== CSV import #1"; curl -s $B/api/import/posts -H "Authorization: Bearer $B2" -H 'content-type: text/csv' --data-binary @/tmp/ge-posts.csv; echo
echo "== CSV import #2 (same file)"; curl -s $B/api/import/posts -H "Authorization: Bearer $B2" -H 'content-type: text/csv' --data-binary @/tmp/ge-posts.csv; echo
echo "== JSON import (1 new, 1 dup)"; curl -s $B/api/import/posts -H "Authorization: Bearer $B2" -H "$J" -d '[{"posted_at":"2026-10-04T10:00:00Z","type":"REEL","likes":5,"reach":100,"caption":"new"},{"posted_at":"2026-10-02T12:00:00Z","type":"IMAGE","likes":300,"comments":10,"saves":5,"shares":2,"reach":2500,"caption":"Behind the scenes"}]'; echo
echo "== status B2"; curl -s $B/api/import/status -H "Authorization: Bearer $B2"; echo
echo "== B2 /api/posts:"; curl -s $B/api/posts -H "Authorization: Bearer $B2" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d),sorted(p['caption'] for p in d))"
echo "== A status unchanged:"; curl -s $B/api/import/status -H "Authorization: Bearer $A"; echo
JID=$(curl -s $B/api/import/posts -H "Authorization: Bearer $B2" -H "$J" -d '[{"posted_at":"2026-10-05T10:00:00Z","type":"REEL","reach":10,"caption":"j"}]' | jget "['jobId']")
echo "== job ownership:"; curl -s -o /dev/null -w "other user->%{http_code}  " $B/api/import/jobs/$JID -H "Authorization: Bearer $A"; curl -s -o /dev/null -w "owner->%{http_code}\n" $B/api/import/jobs/$JID -H "Authorization: Bearer $B2"
echo "== unauth:"; curl -s -o /dev/null -w "%{http_code}\n" $B/api/import/status
echo "== bad body:"; curl -s $B/api/import/posts -H "Authorization: Bearer $B2" -H "$J" -d '{"x":1}'; echo
echo "== B2 sees none of A's posts (A has seeded 50):"; curl -s $B/api/posts -H "Authorization: Bearer $B2" | python3 -c "import sys,json;print(sum('Demo caption' in (p['caption'] or '') for p in json.load(sys.stdin)))"
