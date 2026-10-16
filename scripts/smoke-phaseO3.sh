# Checks for roadmap O.3 (brand voice). Needs: API on :3055 (INLINE_WORKER=1 npm run dev), a migrated database (npm run migrate), psql and DATABASE_URL in the environment.
# Registers throwaway users (harmless on a dev database; do not run it against production). Compare each output with its "expect" note.
# It never calls a real AI provider on purpose: the one consent+key check stores a FAKE key, so the provider refuses it and the app must fall back to the template.
# Run alone or wait a minute between smoke scripts (the API allows 120 requests/minute per IP). Run: DATABASE_URL=postgres://... bash scripts/smoke-phaseO3.sh
B=localhost:3055; J='content-type: application/json'; DB="${DATABASE_URL:?set DATABASE_URL}"
jget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
sql(){ psql "$DB" -tAc "$1"; }
reg(){ curl -s $B/api/auth/register -H "$J" -d '{"email":"'$1'","password":"password123","acceptTos":true}' | jget "['token']"; }
EA="o3a$RANDOM$RANDOM@x.com"; EB="o3b$RANDOM$RANDOM@x.com"
code(){ curl -s -o /tmp/o3.json -w '%{http_code} ' "$@"; }
HA="Authorization: Bearer $(reg $EA)"; HB="Authorization: Bearer $(reg $EB)"
show(){ python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }

echo "== no voice yet (expect voice None, 0 versions, 0 samples, llm.available False)"
curl -s $B/api/voice -H "$HA" | show "print('  voice',d['voice'],'| versions',len(d['versions']),'| samples',len(d['samples']),'| llm',d['llm'])"
echo "== generate with nothing to go on (expect 400)"; code -X POST $B/api/onboarding/voice/generate -H "$HA" -H "$J" -d '{}'; echo
echo "== bad input (expect 400 400 400 400)"
code -X PUT $B/api/voice -H "$HA" -H "$J" -d '{"formality":"stiff"}'; code -X PUT $B/api/voice -H "$HA" -H "$J" -d '{"colour":"red"}'
code -X POST $B/api/onboarding/voice/generate -H "$HA" -H "$J" -d '{"tone_tags":["warm"],"consent":"yes"}'; code -X PUT $B/api/voice -H "$HA" -H "$J" -d '{}'; echo
echo "== save chips (expect 200, version 1, source edited, a template summary mentioning warm)"
curl -s -X PUT $B/api/voice -H "$HA" -H "$J" -d '{"tone_tags":["warm","playful"],"formality":"casual","emoji_use":"low","do":["ask a question, then listen"],"dont":["hype words"]}' | show "v=d['voice'];print('  version',v['version'],'| source',v['source'],'|',v['summary'])"
echo "== generate without consent (expect version 2, source template, reason no_consent)"
curl -s -X POST $B/api/onboarding/voice/generate -H "$HA" -H "$J" -d '{"hashtag_style":"niche"}' | show "print('  version',d['voice']['version'],'| source',d['voice']['source'],'| llm',d['llm'],'| kept tone',d['voice']['tone_tags'],'| hashtag',d['voice']['hashtag_style'])"
echo "== generate WITH consent but no key of your own (expect version 3, template, reason no_user_key; the server's env key is never used for samples)"
curl -s -X POST $B/api/onboarding/voice/generate -H "$HA" -H "$J" -d '{"consent":true}' | show "print('  version',d['voice']['version'],'| source',d['voice']['source'],'| llm',d['llm'])"
echo "== examples: add liked, disliked, link (expect 201 201 201); bad link and bad kind (expect 400 400)"
code -X POST $B/api/voice/samples -H "$HA" -H "$J" -d '{"kind":"liked","text":"Monday coffee hits different."}'
code -X POST $B/api/voice/samples -H "$HA" -H "$J" -d '{"kind":"disliked","text":"BUY NOW!!!"}'
code -X POST $B/api/voice/samples -H "$HA" -H "$J" -d '{"kind":"reference_link","url":"https://example.com/p/1"}'
code -X POST $B/api/voice/samples -H "$HA" -H "$J" -d '{"kind":"reference_link","url":"javascript:alert(1)"}'
code -X POST $B/api/voice/samples -H "$HA" -H "$J" -d '{"kind":"meh","text":"x"}'; echo
SID=$(curl -s $B/api/voice -H "$HA" | jget "['samples'][0]['id']")
echo "== user B cannot see or delete A's example (expect samples 0, then 404); A deletes it (expect 200, then 404)"
curl -s $B/api/voice -H "$HB" | show "print('  B samples',len(d['samples']),'| B voice',d['voice'])"
code -X DELETE $B/api/voice/samples/$SID -H "$HB"; code -X DELETE $B/api/voice/samples/$SID -H "$HA"; code -X DELETE $B/api/voice/samples/$SID -H "$HA"; echo
echo "== bad id (expect 400)"; code -X DELETE $B/api/voice/samples/abc -H "$HA"; echo
echo "== FAKE own key + consent (expect llm.available True, then template with reason llm_failed or llm_invalid: the provider refuses the fake key)"
curl -s -o /dev/null -X PUT $B/api/settings/keys/openai -H "$HA" -H "$J" -d '{"value":"sk-fake-not-a-real-key"}'
curl -s $B/api/voice -H "$HA" | show "print('  llm',d['llm'])"
curl -s -X POST $B/api/onboarding/voice/generate -H "$HA" -H "$J" -d '{"consent":true}' | show "print('  source',d['voice']['source'],'| llm',d['llm'])"
curl -s -o /dev/null -X DELETE $B/api/settings/keys/openai -H "$HA"
echo "== versions are all kept (expect 4 versions for A, the list newest first)"
curl -s $B/api/voice -H "$HA" | show "print('  ',[ (v['version'],v['source']) for v in d['versions']])"
echo "== wizard: 'Yes, that is me' = PATCH /onboarding/voice {} (expect step advances past voice, voice NOT in skippedSteps)"
curl -s -o /dev/null -X PATCH $B/api/onboarding/about -H "$HA" -H "$J" -d '{"display_name":"Mo"}'
curl -s -X PATCH $B/api/onboarding/voice -H "$HA" -H "$J" -d '{}' | show "print('  step',d['step'],'| skipped',d['skippedSteps'])"
echo "== captions/hashtags still answer as before without any AI key (expect 503 503; the request must not crash on the new voice lookup)"
code -X POST $B/api/content/captions -H "$HA" -H "$J" -d '{"topic":"launch"}'; code -X POST $B/api/content/hashtags -H "$HA" -H "$J" -d '{"niche":"coffee"}'; echo
echo "== GDPR export lists the new tables (expect brand_voice 4 rows, voice_samples 2 rows)"
curl -s $B/api/gdpr/export -H "$HA" | show "print('  brand_voice',len(d['brand_voice']),'| voice_samples',len(d['voice_samples']))"
echo "== 401 without a token (expect 401 x5)"
code $B/api/voice; code -X PUT $B/api/voice; code -X POST $B/api/voice/samples; code -X DELETE $B/api/voice/samples/1; code -X POST $B/api/onboarding/voice/generate; echo
echo "== deleting the account removes the voice (expect 0 rows left)"
code -X DELETE $B/api/gdpr/account -H "$HA"; echo
echo "  rows left for A: $(sql "SELECT (SELECT count(*) FROM brand_voice WHERE user_id NOT IN (SELECT id FROM users))+(SELECT count(*) FROM voice_samples WHERE user_id NOT IN (SELECT id FROM users))") (orphans; expect 0)"
echo "  user A still exists: $(sql "SELECT count(*) FROM users WHERE email='$EA'") (expect 0)"
