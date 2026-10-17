# Checks for roadmap O.4 (GET /api/goal and the baseline reset) and 4.2 (/api/responses save, list, delete, scoping).
# Needs: API on :3055 (INLINE_WORKER=1 npm run dev), a migrated database, psql, python3 and DATABASE_URL.
# Registers throwaway users and writes rows (dev database only). Compare each output with its "expect" note.
# The API allows 120 requests/minute per IP: run this script alone or wait a minute after another smoke script.
# NOTE: this file was RE-WRITTEN in session 11 after the sandbox copy of the earlier version was lost. It has been syntax-checked (bash -n) only; it has not run since the rewrite.
B=localhost:3055; J='content-type: application/json'; DB="${DATABASE_URL:?set DATABASE_URL}"
jget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
show(){ python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
sql(){ psql "$DB" -tAc "$1"; }
reg(){ curl -s $B/api/auth/register -H "$J" -d '{"email":"'$1'","password":"password123","acceptTos":true}' | jget "['token']"; }
code(){ curl -s -o /tmp/o442.json -w '%{http_code} ' "$@"; }
EA="o4a$RANDOM$RANDOM@x.com"; EB="o4b$RANDOM$RANDOM@x.com"
HA="Authorization: Bearer $(reg $EA)"; HB="Authorization: Bearer $(reg $EB)"
UA=$(sql "SELECT id FROM users WHERE email='$EA'")

echo "== no token (expect 401 401 401 401)"
for p in goal responses; do curl -s -o /dev/null -w '%{http_code} ' $B/api/$p; done; curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/responses/save; curl -s -o /dev/null -w '%{http_code} ' -X DELETE $B/api/responses/1; echo

echo "== O.4: new user, no goal (expect hasGoal False and an explanation that asks for a goal)"
curl -s $B/api/goal -H "$HA" | show "print('  hasGoal',d['hasGoal'],'|',d.get('explanation'))"

echo "== O.4: set a followers goal in the profile (expect 200)"
code -X PATCH $B/api/onboarding/about -H "$HA" -H "$J" -d '{"display_name":"Smoke"}'
code -X PATCH $B/api/onboarding/goals -H "$HA" -H "$J" -d '{"goal_primary":"followers","goal_target_metric":"followers","goal_target_value":2000,"goal_deadline":"2027-12-31"}'; echo
echo "== O.4: GET /api/goal with no follower history (expect hasGoal True, metric followers, NO invented number from reach: percent null or absent, an explanation that says there is no follower history)"
curl -s $B/api/goal -H "$HA" | show "print('  hasGoal',d['hasGoal'],'| metric',d.get('metric'),'| percent',d.get('percent'),'| pace',d.get('pace'),'|',d.get('explanation'))"

echo "== O.4: give the user follower history, then ask again (expect a baseline stored once, a percent between 0 and 100, dataUsed mentioning followers)"
sql "INSERT INTO follower_history(user_id,captured_at,followers,source) VALUES('$UA',now()-interval '10 days',1000,'live'),('$UA',now(),1100,'live')" >/dev/null
curl -s $B/api/goal -H "$HA" | show "print('  percent',d.get('percent'),'| pace',d.get('pace'),'| baseline',d.get('baseline'),'| current',d.get('current'),'| dataUsed',d.get('dataUsed'))"
echo "  stored baseline (expect 1000 or 1100: the value when the goal first became measurable):"; sql "SELECT goal_baseline_value FROM business_profile WHERE user_id='$UA'"
B1=$(sql "SELECT goal_baseline_value FROM business_profile WHERE user_id='$UA'")
curl -s -o /dev/null $B/api/goal -H "$HA"; B2=$(sql "SELECT goal_baseline_value FROM business_profile WHERE user_id='$UA'")
echo "== O.4: a second read does not move the baseline (expect same: $B1 = $B2)"; [ "$B1" = "$B2" ] && echo "  same" || echo "  CHANGED"

echo "== O.4: change the target number -> baseline reset (expect NULL right after the PATCH, filled again by the next GET)"
code -X PATCH $B/api/onboarding/goals -H "$HA" -H "$J" -d '{"goal_target_value":3000}'; echo
echo "  right after PATCH (expect empty):"; sql "SELECT coalesce(goal_baseline_value::text,'')  FROM business_profile WHERE user_id='$UA'"
curl -s -o /dev/null $B/api/goal -H "$HA"; echo "  after the next GET (expect a number):"; sql "SELECT coalesce(goal_baseline_value::text,'') FROM business_profile WHERE user_id='$UA'"
echo "== O.4: changing only the deadline does NOT reset it (expect same number as above)"
code -X PATCH $B/api/onboarding/goals -H "$HA" -H "$J" -d '{"goal_deadline":"2028-06-30"}'; echo; sql "SELECT coalesce(goal_baseline_value::text,'') FROM business_profile WHERE user_id='$UA'"
echo "== O.4: user B has no goal and sees nothing of A (expect hasGoal False)"
curl -s $B/api/goal -H "$HB" | show "print('  hasGoal',d['hasGoal'])"

echo "== 4.2: empty list (expect 0)"; curl -s $B/api/responses -H "$HA" | show "print(' ',len(d['responses']))"
echo "== 4.2: validation (expect 400 x6: kind, original missing, edited missing, unchanged, empty edit, too long)"
code -X POST $B/api/responses/save -H "$HA" -H "$J" -d '{"kind":"nope","original":"a","edited":"b"}'
code -X POST $B/api/responses/save -H "$HA" -H "$J" -d '{"edited":"b"}'
code -X POST $B/api/responses/save -H "$HA" -H "$J" -d '{"original":"a"}'
code -X POST $B/api/responses/save -H "$HA" -H "$J" -d '{"original":"same","edited":" same "}'
code -X POST $B/api/responses/save -H "$HA" -H "$J" -d '{"original":"a","edited":"   "}'
code -X POST $B/api/responses/save -H "$HA" -H "$J" -d "{\"original\":\"a\",\"edited\":\"$(python3 -c "print('x'*4001)")\"}"; echo
echo "== 4.2: save (expect 200 and an edited text), save the same original again (expect the SAME id and the newer edit; list still 1 row)"
curl -s -X POST $B/api/responses/save -H "$HA" -H "$J" -d '{"original":"Post more reels.","edited":"Post two reels a week."}' | show "r=d['response'];print('  id',r['id'],'|',r['edited'],'| original kept:',r['original'])"
curl -s -X POST $B/api/responses/save -H "$HA" -H "$J" -d '{"original":"Post more reels.","edited":"Post three reels a week."}' | show "r=d['response'];print('  id',r['id'],'|',r['edited'])"
curl -s $B/api/responses -H "$HA" | show "print('  rows',len(d['responses']),'| edited',d['responses'][0]['edited'])"
RID=$(curl -s $B/api/responses -H "$HA" | jget "['responses'][0]['id']")
echo "== 4.2: unicode and quotes survive (expect the text back unchanged)"
curl -s -X POST $B/api/responses/save -H "$HA" -H "$J" -d '{"original":"عنوان \"quoted\" \\ back","edited":"عنوان معدل 😍 \"q\""}' | show "print(' ',d['response']['edited'])"
echo "== 4.2: list limit (expect 200 for 1, 400 for 0 / 201 / abc)"
code "$B/api/responses?limit=1" -H "$HA"; code "$B/api/responses?limit=0" -H "$HA"; code "$B/api/responses?limit=201" -H "$HA"; code "$B/api/responses?limit=abc" -H "$HA"; echo
echo "== 4.2: scoping. B sees none of A's rows (expect 0), B cannot delete A's row (expect 404), A can (expect 200 then 404), bad id (expect 400)"
curl -s $B/api/responses -H "$HB" | show "print('  B rows',len(d['responses']))"
code -X DELETE $B/api/responses/$RID -H "$HB"; code -X DELETE $B/api/responses/$RID -H "$HA"; code -X DELETE $B/api/responses/$RID -H "$HA"; code -X DELETE $B/api/responses/abc -H "$HA"; echo
echo "== 4.2: B saves the SAME original text as A (expect 200: rows are per user)"
code -X POST $B/api/responses/save -H "$HB" -H "$J" -d '{"original":"عنوان \"quoted\" \\ back","edited":"B edit"}'; echo

echo "== 4.2: the 500-row cap (expect the 500th save 200, the 501st 409, rows 500, editing an existing original at the cap 200; skip with SKIP_BULK=1)"
if [ -z "$SKIP_BULK" ]; then
  sql "DELETE FROM saved_responses WHERE user_id='$UA'" >/dev/null
  echo "  NOTE: the save route allows 120 per hour per user, so 499 rows are inserted with SQL and only the last two go through the API (that is enough to prove the cap check in the handler)."
  sql "INSERT INTO saved_responses(user_id,original,edited) SELECT '$UA','orig '||g,'edit '||g FROM generate_series(1,499) g" >/dev/null
  code -X POST $B/api/responses/save -H "$HA" -H "$J" -d '{"original":"the 500th","edited":"the 500th edited"}'
  code -X POST $B/api/responses/save -H "$HA" -H "$J" -d '{"original":"the 501st","edited":"the 501st edited"}'
  echo; echo "  rows (expect 500):"; sql "SELECT count(*) FROM saved_responses WHERE user_id='$UA'"
  echo "  editing an EXISTING original at the cap still works (expect 200):"; code -X POST $B/api/responses/save -H "$HA" -H "$J" -d '{"original":"orig 1","edited":"edited again"}'; echo
fi

echo "== 4.2 + GDPR: export lists saved_responses; account delete removes them (expect export has the key, then 0 rows after delete)"
curl -s $B/api/gdpr/export -H "$HB" | show "print('  has saved_responses key:', 'saved_responses' in d, '| rows', len(d['saved_responses']))"
UB=$(sql "SELECT id FROM users WHERE email='$EB'")
code -X DELETE $B/api/gdpr/account -H "$HB"; echo; sql "SELECT count(*) FROM saved_responses WHERE user_id='$UB'"
echo "== account delete cascade for A (expect 0 saved_responses, 0 business_profile, 0 follower_history)"
code -X DELETE $B/api/gdpr/account -H "$HA"; echo; sql "SELECT (SELECT count(*) FROM saved_responses WHERE user_id='$UA'),(SELECT count(*) FROM business_profile WHERE user_id='$UA'),(SELECT count(*) FROM follower_history WHERE user_id='$UA')"
