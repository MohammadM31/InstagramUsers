# Checks for the Phase 1 fix patch. Start the API (INLINE_WORKER=1 npm run dev, PORT=3055) after `npm run migrate`, then: bash scripts/smoke-fix1.sh
# Uses a fresh throwaway user. Compare each output with its "expect" note.
B=localhost:3055; J='content-type: application/json'
jget(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
R=$(curl -s $B/api/auth/register -H "$J" -d '{"email":"fx'$RANDOM'@x.com","password":"password123","acceptTos":true}'); H="Authorization: Bearer $(echo $R | jget "['token']")"
posts(){ curl -s $B/api/posts -H "$H" | python3 -c "import sys,json;[print(' ',{k:p[k] for k in ('caption','likes','comments','saves','shares','reach','impressions','watch_s')}) for p in json.load(sys.stdin) if p['caption']=='$1']"; }
echo "== 0.1b partial refresh must not erase metrics"
curl -s $B/api/import/posts -H "$H" -H "$J" -d '[{"posted_at":"2026-10-04T10:00:00Z","type":"REEL","likes":5,"comments":2,"saves":9,"shares":4,"reach":100,"impressions":130,"watch_s":12,"caption":"fx-refresh"}]'; echo "  <- expect imported 1"
posts fx-refresh
printf 'date,type,likes,reach,caption\n2026-10-04T10:00:00Z,reel,50,120,fx-refresh\n' | curl -s "$B/api/import/posts?update=1" -H "$H" -H 'content-type: text/csv' --data-binary @-; echo "  <- expect imported 0, duplicates 1, updated 1"
posts fx-refresh; echo "  ^ expect likes 50, reach 120 and comments 2, saves 9, shares 4, impressions 130, watch_s 12 UNCHANGED"
curl -s "$B/api/import/posts?update=1" -H "$H" -H "$J" -d '[{"posted_at":"2026-10-04T10:00:00Z","type":"REEL","likes":50,"saves":0,"reach":120,"caption":"fx-refresh"}]'; echo "  <- expect updated 1 (explicit saves 0 is a real value)"
posts fx-refresh; echo "  ^ expect saves 0, shares 4, impressions 130 still unchanged"
curl -s "$B/api/import/posts?update=1" -H "$H" -H "$J" -d '[{"posted_at":"2026-10-04T10:00:00Z","type":"REEL","likes":50,"saves":0,"reach":120,"caption":"fx-refresh"}]'; echo "  <- expect updated 0 (nothing changed)"
echo "== dates: ambiguous rejected with a line number, unambiguous accepted"
printf 'date,type,likes,reach,caption\n01/10/2026,reel,5,100,fx-amb\n13/10/2026,reel,5,100,fx-ok\n' | curl -s $B/api/import/posts -H "$H" -H 'content-type: text/csv' --data-binary @-; echo "  <- expect imported 1, invalid 1, invalidSample row 2 'ambiguous date ... Use ISO format'"
echo "== type aliases (expect imported 2)"
curl -s $B/api/import/posts -H "$H" -H "$J" -d '[{"posted_at":"2026-10-05T10:00:00Z","type":"IG Reel","reach":50,"caption":"fx-igreel"},{"posted_at":"2026-10-05T11:00:00Z","type":"Story","reach":50,"caption":"fx-story"}]'; echo
curl -s $B/api/posts -H "$H" | python3 -c "import sys,json;print(' ',[(p['caption'],p['type']) for p in json.load(sys.stdin) if p['caption'] in ('fx-igreel','fx-story')],' <- expect REEL and IMAGE')"
echo "== /schedule validation (expect 400 400 400 then 200)"
for b in '{"caption":"x","scheduledAt":"garbage"}' '{"caption":"x","scheduledAt":"2026-13-45"}'; do curl -s -o /dev/null -w "%{http_code} " $B/api/schedule -H "$H" -H "$J" -d "$b"; done
ID=$(curl -s $B/api/schedule -H "$H" -H "$J" -d '{"caption":"fx","scheduledAt":"2099-01-01T10:00:00Z"}' | jget "['id']")
curl -s -o /dev/null -w "%{http_code} " -X PATCH $B/api/schedule/$ID -H "$H" -H "$J" -d '{"scheduledAt":"nope"}'
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH $B/api/schedule/$ID -H "$H" -H "$J" -d '{"scheduledAt":"2099-02-01T10:00:00Z"}'
echo "== image 503 does not spend the budget (only meaningful with NO Replicate key configured: expect 25 x 503 and no 429)"
for i in $(seq 25); do curl -s -o /dev/null -w "%{http_code} " $B/api/content/image -H "$H" -H "$J" -d '{"prompt":"x"}'; done; echo
