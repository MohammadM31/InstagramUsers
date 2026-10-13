# Regression smoke over pre-existing endpoints. Needs the seeded demo user. Usage: bash scripts/smoke-regression.sh
B=localhost:3055; J='content-type: application/json'
jget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
A=$(curl -s $B/api/auth/login -H "$J" -d '{"email":"demo@growthengine.ai","password":"demo1234"}' | jget "['token']"); H="Authorization: Bearer $A"
c(){ printf '%-34s' "$1"; shift; curl -s -o /tmp/o.json -w '%{http_code}  ' "$@"; head -c 110 /tmp/o.json; echo; }
c "GET /dashboard" $B/api/dashboard -H "$H"
c "GET /posts" $B/api/posts -H "$H"
c "GET /analytics/insights" $B/api/analytics/insights -H "$H"
c "GET /analytics/heatmap" $B/api/analytics/heatmap -H "$H"
c "GET /competitors" $B/api/competitors -H "$H"
c "POST /competitors" $B/api/competitors -H "$H" -H "$J" -d '{"handle":"@testcomp"}'
c "POST /assistant (analytics)" $B/api/assistant -H "$H" -H "$J" -d '{"message":"how am i doing"}'
c "POST /assistant (finance)" $B/api/assistant -H "$H" -H "$J" -d '{"message":"budget $1000"}'
c "GET /finance/plan" "$B/api/finance/plan?capital=1000" -H "$H"
c "POST /schedule" $B/api/schedule -H "$H" -H "$J" -d '{"caption":"hi","scheduledAt":"2026-12-01T10:00:00Z"}'
c "GET /schedule" $B/api/schedule -H "$H"
c "POST /content/captions (no key)" $B/api/content/captions -H "$H" -H "$J" -d '{"topic":"x"}'
c "GET /gdpr/export" $B/api/gdpr/export -H "$H"
curl -s $B/api/gdpr/export -H "$H" | python3 -c "import sys,json;d=json.load(sys.stdin);print('   export keys:',sorted(d), '| api_keys has ciphertext:', any('enc' in k for k in d['api_keys']))"
c "assistant image, no replicate key" $B/api/assistant -H "$H" -H "$J" -d '{"message":"image of a coffee cup"}'
c "register dup email" $B/api/auth/register -H "$J" -d '{"email":"demo@growthengine.ai","password":"password123","acceptTos":true}'
c "register no ToS" $B/api/auth/register -H "$J" -d '{"email":"n@x.com","password":"password123"}'
c "no token" $B/api/dashboard
