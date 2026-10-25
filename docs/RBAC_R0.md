# R.0 platform foundations: how to try it on Windows (curl.exe)

Everything below works in **cmd.exe** and in **PowerShell** with the real `curl.exe` (in PowerShell type `curl.exe`, not `curl`, which is a different built-in command).
JSON is sent from small files with `--data-binary "@file"`, so you never fight quoting rules.

## 0. Setup
1. `npm run migrate` (run it twice: the second run must change nothing and print no error). It prints `migrated schema.sql` and `migrated schema.rbac.sql`.
2. Sign up, then make that account the owner (see "Platform roles" in the README): set `OWNER_EMAIL` in `.env`, restart `npm run dev`.
3. Create `login.json` next to where you run the commands (use your own email and password):

       {"email":"you@example.com","password":"your-password"}

## 1. Log in and keep the token
cmd.exe:

    curl.exe -s http://localhost:3000/api/auth/login -H "content-type: application/json" --data-binary "@login.json"

Copy the `token` value. In cmd.exe: `set TOKEN=<paste>`. In PowerShell: `$TOKEN="<paste>"`.
(Below, `%TOKEN%` is cmd.exe; in PowerShell write `$TOKEN` instead.)

## 2. Who am I (GET /api/me)

    curl.exe -s http://localhost:3000/api/me -H "Authorization: Bearer %TOKEN%"

Expected: `{"user":{"id":"...","email":"you@example.com","name":null,"role":"owner"},"permissions":[ ...27 names... ]}`. A customer sees `"role":"user"` and `"permissions":[]`.
Without the header: HTTP 401 `{"error":"unauthorized"}`.

## 3. Admin API (needs a staff role)

    curl.exe -s -i http://localhost:3000/api/admin/ping -H "Authorization: Bearer %TOKEN%"

Staff: `200 {"ok":true,"role":"owner"}`. A normal customer's token: `403 {"error":"forbidden"}`. No token: `401`. An unknown admin path as staff: `404 {"error":"not found"}`.

## 4. Sign out everywhere (token_version)
Until the admin users page exists (a later phase), test it by hand in psql:

    psql -U ge -d ge -c "UPDATE users SET token_version=token_version+1 WHERE email='you@example.com'"
    curl.exe -s -i http://localhost:3000/api/me -H "Authorization: Bearer %TOKEN%"

Expected: `401`. Log in again (step 1) and the new token works.

## 5. Suspended accounts
    psql -U ge -d ge -c "UPDATE users SET status='suspended' WHERE email='customer@example.com'"

* The customer's old token: `401` on the next request.
* Logging in with the right password: `403 {"error":"This account is suspended. Contact support."}`. A wrong password still gives `401 invalid credentials`.
* Undo: `UPDATE users SET status='active' WHERE email='customer@example.com'`.

## 6. Audit log cannot be edited
    psql -U ge -d ge -c "UPDATE audit_log SET action='x'"
    psql -U ge -d ge -c "DELETE FROM audit_log"
    psql -U ge -d ge -c "TRUNCATE audit_log"

Each must fail with `audit_log is append-only (... refused)` (the table may be empty; the triggers still fire for TRUNCATE, and for UPDATE/DELETE once a row exists).

## 7. Admin guard check

    npm run check:admin

Expected: `admin guards ok: 1 route file(s), every route has a requirePermission gate`. If someone adds an admin route without `requirePermission(...)`, this command exits with code 1 and lists the route, and the server refuses to start.

## 8. Security counters (Redis)
After 10 wrong logins for one email from one address, then the 11th attempt answers `429`. In `redis-cli` (or Memurai's CLI): `KEYS sec:lockout:*` shows an hourly counter `sec:lockout:<YYYYMMDDHH>` with value 1 (dev only; the server itself never uses `KEYS`).

## 9. Admin screen (browser)
Log in as the owner, open `http://localhost:5173`: an **Admin** entry is at the bottom of the sidebar. Click it: `/admin` shows the Overview page. Log in as a normal customer and open `http://localhost:5173/admin`: you are sent back to the app, and the browser's Network tab shows no admin JavaScript chunk was downloaded.
