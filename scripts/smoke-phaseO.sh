# Checks for roadmap O.1 (business profile + onboarding API). Needs: API on :3055 (INLINE_WORKER=1 npm run dev), a migrated + seeded database, psql and
# DATABASE_URL in the environment. It registers throwaway users (harmless on a dev database; do not run it against production).
# Compare each output with its "expect" note.  Run: DATABASE_URL=postgres://... bash scripts/smoke-phaseO.sh
B=localhost:3055; J='content-type: application/json'; DB="${DATABASE_URL:?set DATABASE_URL}"
jget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
sql(){ psql "$DB" -tAc "$1"; }
reg(){ curl -s $B/api/auth/register -H "$J" -d '{"email":"'$1'","password":"password123","acceptTos":true}' | jget "['token']"; }
EA="oa$RANDOM$RANDOM@x.com"; EB="ob$RANDOM$RANDOM@x.com"
code(){ curl -s -o /tmp/o.json -w '%{http_code} ' "$@"; }
HA="Authorization: Bearer $(reg $EA)"; HB="Authorization: Bearer $(reg $EB)"
DEMO="Authorization: Bearer $(curl -s $B/api/auth/login -H "$J" -d '{"email":"demo@growthengine.ai","password":"demo1234"}' | jget "['token']")"

echo "== demo user is never forced through onboarding (expect completed True, step done)"
curl -s $B/api/onboarding -H "$DEMO" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  completed',d['completed'],'| step',d['step'])"
echo "== new user: nothing saved yet (expect completed False, step about, display_name None, steps list of 6)"
curl -s $B/api/onboarding -H "$HA" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  completed',d['completed'],'| step',d['step'],'| name',d['profile']['display_name'],'| steps',len(d['steps']))"
echo "== complete without a name is refused (expect 400)"; code -X POST $B/api/onboarding/complete -H "$HA"; echo
echo "== save step 'about' twice with the same body (expect 200 200, then ONE row, step connect)"
BODY='{"display_name":"Mo","business_name":"Leet","timezone":"Asia/Beirut","languages":["en","ar"]}'
code -X PATCH $B/api/onboarding/about -H "$HA" -H "$J" -d "$BODY"; code -X PATCH $B/api/onboarding/about -H "$HA" -H "$J" -d "$BODY"; echo
echo "  rows: user A $(sql "SELECT count(*) FROM business_profile b JOIN users u ON u.id=b.user_id WHERE u.email='$EA'") (expect 1), user B $(sql "SELECT count(*) FROM business_profile b JOIN users u ON u.id=b.user_id WHERE u.email='$EB'") (expect 0)"
curl -s $B/api/onboarding -H "$HA" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  step',d['step'],'| tz',d['profile']['timezone'],'| languages',d['profile']['languages'])"
echo "== bad input (expect 400 400 400 404 400)"
code -X PATCH $B/api/onboarding/business -H "$HA" -H "$J" -d '{"stage":"huge"}'
code -X PATCH $B/api/onboarding/about -H "$HA" -H "$J" -d '{"timezone":"Mars/Base"}'
code -X PATCH $B/api/onboarding/goals -H "$HA" -H "$J" -d '{"goal_primary":"sales","goal_secondary":"sales"}'
code -X PATCH $B/api/onboarding/nope -H "$HA" -H "$J" -d '{}'
code -X PATCH $B/api/onboarding/about -H "$HA" -H "$J" -d '{"skipped":true}'; echo
echo "== skip steps, resume after 'reload' (expect skippedSteps [connect, voice], step goals)"
for s in connect business voice; do curl -s -o /dev/null -X PATCH $B/api/onboarding/$s -H "$HA" -H "$J" -d '{"skipped":true}'; done
curl -s $B/api/onboarding -H "$HA" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  step',d['step'],'| skipped',d['skippedSteps'])"
echo "== goals + content saved (numbers come back as numbers, date as YYYY-MM-DD)"
curl -s -X PATCH $B/api/onboarding/goals -H "$HA" -H "$J" -d '{"goal_primary":"followers","goal_target_metric":"followers","goal_target_value":5000,"goal_deadline":"2027-03-01"}' | python3 -c "import sys,json;p=json.load(sys.stdin)['profile'];print('  ',p['goal_primary'],p['goal_target_value'],type(p['goal_target_value']).__name__,p['goal_deadline'])"
curl -s -o /dev/null -X PATCH $B/api/onboarding/content -H "$HA" -H "$J" -d '{"posts_per_week":4,"content_by":"me","video_ok":true,"auto_proposals":false}'
echo "== another user cannot see user A's profile (expect None None; PUT /profile for B with no row -> 409)"
curl -s $B/api/profile -H "$HB" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  ',d['display_name'],d['goal_primary'])"
code -X PUT $B/api/profile -H "$HB" -H "$J" -d '{"niche":"x"}'; echo
echo "== PUT /profile edits later without touching progress (expect 200, niche coffee, step unchanged, then 400 for posts_per_week 99)"
code -X PUT $B/api/profile -H "$HA" -H "$J" -d '{"niche":"coffee"}'; code -X PUT $B/api/profile -H "$HA" -H "$J" -d '{"posts_per_week":99}'; echo
echo "== finish (expect 200 twice, same completedAt)"
A1=$(curl -s -X POST $B/api/onboarding/complete -H "$HA" | jget "['completedAt']"); A2=$(curl -s -X POST $B/api/onboarding/complete -H "$HA" | jget "['completedAt']"); echo "  $A1 / $A2 -> $([ "$A1" = "$A2" ] && echo same || echo DIFFERENT)"
echo "== auth required (expect 401 401 401)"; code $B/api/onboarding; code -X PATCH $B/api/onboarding/about; code $B/api/profile; echo
echo "== GDPR export lists business_profile; deleting the account removes it (expect 1 row in export, then 0 rows)"
curl -s $B/api/gdpr/export -H "$HA" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  business_profile rows in export:',len(d['business_profile']))"
UIDA=$(sql "SELECT id FROM users WHERE email='$EA'")
curl -s -o /dev/null -X DELETE $B/api/gdpr/account -H "$HA"; echo "  rows left for that user: $(sql "SELECT count(*) FROM business_profile WHERE user_id='$UIDA'") (and users row: $(sql "SELECT count(*) FROM users WHERE id='$UIDA'"))"
echo "== existing endpoints unchanged (expect 200 200 200)"; code $B/api/dashboard -H "$DEMO"; code $B/api/priorities -H "$DEMO"; code $B/api/notifications -H "$DEMO"; echo
