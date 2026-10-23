# Parallel work contract: Command Center chat, image library, history, albums

Commit this file to `main` as `docs/parallel/CONTRACT.md` BEFORE starting any agent. Every agent reads it first.
Repo: MohammadM31/InstagramUsers (Express + Postgres + Redis/BullMQ, React in web/, Node 22, dev on Windows, no Docker assumed).

## 0. How the parallel work stays safe
- Six agents work at the same time, each in its OWN git worktree/branch (`feat/<stream>`), branched from the same `main` commit. A seventh (integrator) runs after they merge.
- File ownership (section 2) is exclusive. NEVER edit a file you do not own, even for a one-line fix. If you need a change elsewhere, finish your work and list it under "Requests for integrator" in your final report.
- Streams share NO code imports and NO foreign keys. They talk only through the HTTP and data contracts below. This is what lets them run without waiting on each other.
- Everything in sections 3 and 4 is law. If you believe the contract is wrong, implement it anyway, and say so in your report.
- Do not edit the `test` script in package.json (integrator does). Run your own tests with `node --test test/<yourfile>.test.js`. Keep every existing test passing (`npm test` at the start, and again at the end). Several existing tests are source-grep style (they assert exact text in src files): if you change a line such a test asserts, update that test in the same commit, and only if you own that test (section 2).
- Style: follow the repo (ESM, terse code, dependency-injected factories `makeX({q,...})` so logic is unit-testable without Redis/Postgres, `node:test`, comments that say WHY). No new npm dependencies (sharp is already installed). Frontend: React 18 + TypeScript, `npm run build` in web/ must pass (`tsc --noEmit && vite build`).
- Never commit secrets. Every DB query that touches user data MUST filter by the authenticated user (`req.uid`); another user's id returns 404, never data.
- Final report format: (1) what you built, (2) files changed, (3) tests added and how to run them, (4) what you could NOT verify (needs Redis/Postgres/Replicate/browser), (5) Requests for integrator, (6) deviations from the contract.

## 1. Findings in the current code (root causes)
1. Scrolling: `.assistant-page .page-thread{overflow:visible}` and `.cc-content.interacted{justify-content:flex-start}` make the thread grow the whole page downward. The `useEffect` in Assistant.tsx that sets `threadRef.scrollTop` does nothing because the thread is not a scroller. The composer is `position:sticky`, so the user must scroll the page by hand.
2. Old messages change: in `poll()` (Assistant.tsx) the code walks back to "the last assistant message" and overwrites it with "Generating your image..." (`copy[k]={...c,type:'image',...}`). In image mode no placeholder is pushed first, so it overwrites the previous assistant answer (an analytics card turns into a spinner). Messages also use `key={i}`, and a new send cancels the previous poll through `seq`, leaving stuck placeholders.
3. Image mode skips the LLM: with the image toggle on, the UI posts the raw text to `/content/image`. Then `refinePrompt()` in images.js rewrites it into a brand-new text-to-image prompt with no knowledge of the previous image, which destroys an instruction like "make the drink hot not iced". The assistant's `route()` has no conversation context and falls back to regex keywords. The reference image only exists if the user uploads a file each time (base64 from FileReader). Generated images exist only in the BullMQ job result (1 hour TTL).
4. No history: messages live in React state; `/assistant` is stateless by design.
5. No saving: nothing persists a generated post. Note `stored_images` + `IMAGE_RETENTION_DAYS` (30 days) purge bucket objects: the new library must NOT depend on that purge.
6. Side bug: the Command Center "connection" pill does `dispatchEvent(new Event('nav'))` and sets `location.hash`, but App.tsx listens to neither, so it does nothing. Stream 6 fixes this with a hash router.

## 2. File ownership
| Stream | Name | Owns (exclusive) |
|---|---|---|
| 1 | chat-ui | web/src/Assistant.tsx, web/src/pages/CommandCenter.tsx, web/src/styles.css, web/src/cc.ts, new web/src/chat/**, test/chatUi.test.js, test/commandCenter.test.js |
| 2 | history-api | new src/conversations.js, new db/schema.conversations.sql, new test/conversations.test.js |
| 3 | image-library | new src/imagelib.js, new db/schema.imagelib.sql, src/imageresult.js, src/worker.js, new test/imagelib.test.js, and ONLY the worker/processImage assertions in test/storage.test.js and test/storedimages.test.js |
| 4 | image-brain | src/assistant.js, src/images.js, new src/imageintent.js, new test/imageintent.test.js |
| 5 | albums-api | new src/albums.js, new db/schema.albums.sql, new test/albums.test.js |
| 6 | albums-ui | web/src/App.tsx, web/src/icons.tsx, new web/src/pages/Albums.tsx, new web/src/albums/**, new web/src/albums.css, new test/albumsUi.test.js |
| 7 | integrator (after merge) | src/routes.js, src/migrate.js, package.json, README.md, docs/**, anything cross-stream |

## 3. Data contract (DDL). Each stream creates ONLY its own tables, in its own schema file, idempotent (`IF NOT EXISTS`). No foreign keys across streams (ids are plain uuid columns). Integrator makes migrate.js run `db/schema.sql` then every `db/schema.*.sql`.

### 3.1 Stream 2: db/schema.conversations.sql
```sql
CREATE TABLE IF NOT EXISTS conversations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 title text NOT NULL DEFAULT 'New chat',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS conversations_user_updated ON conversations(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS conversation_messages(
 id bigserial PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES conversations ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('user','assistant')),
 type text NOT NULL DEFAULT 'info',          -- info | tip | analytics | finance | image
 text text NOT NULL DEFAULT '',
 data jsonb NOT NULL DEFAULT '{}',           -- what the UI renders; NEVER base64 image bytes
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS conversation_messages_conv ON conversation_messages(conversation_id, id);
```
### 3.2 Stream 3: db/schema.imagelib.sql
```sql
CREATE TABLE IF NOT EXISTS generated_images(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 job_id text,                                 -- BullMQ job id (null for uploads)
 idx int NOT NULL DEFAULT 0,                  -- position inside the job (n up to 2)
 conversation_id uuid,                        -- plain column, no FK
 parent_image_id uuid,                        -- the image this one was edited from (lineage), no FK
 kind text NOT NULL DEFAULT 'generate' CHECK (kind IN ('generate','edit','upload')),
 prompt text, instruction text, ratio text, model text,
 mime text NOT NULL DEFAULT 'image/jpeg',
 bytes bytea NOT NULL,                        -- full image, JPEG q95 4:4:4 (limits generation loss across repeated edits)
 thumb bytea NOT NULL,                        -- 384px wide JPEG q78
 width int, height int,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS generated_images_user ON generated_images(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS generated_images_job ON generated_images(job_id, idx) WHERE job_id IS NOT NULL;
```
### 3.3 Stream 5: db/schema.albums.sql
```sql
CREATE TABLE IF NOT EXISTS album_folders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS album_folders_name ON album_folders(user_id, lower(name));
CREATE TABLE IF NOT EXISTS saved_posts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 title text NOT NULL DEFAULT 'Untitled post',
 category text NOT NULL CHECK (category IN ('reel','photo','carousel','story','other')),
 category_source text NOT NULL DEFAULT 'auto' CHECK (category_source IN ('auto','user')),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready')),
 caption text NOT NULL DEFAULT '',
 image_ids uuid[] NOT NULL DEFAULT '{}',      -- first one is the cover; plain uuids, no FK
 ratio text,
 folder_id uuid REFERENCES album_folders ON DELETE SET NULL,
 conversation_id uuid,                        -- lets "Continue editing" reopen the chat
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS saved_posts_user ON saved_posts(user_id, category, updated_at DESC);
```
Streams 2 and 5 may read `generated_images(id,user_id)` read-only (ownership/lineage checks) but must tolerate the table not existing (catch the error and degrade) so they run standalone.

## 4. HTTP contract (all under /api, all authenticated, all JSON; ids are uuid strings except message ids which are strings of bigint)

### 4.1 Assistant (existing route, additive changes). Owner of behavior: stream 4. Wrapper adds persistence: stream 2.
`POST /api/assistant` body (all new fields optional):
`{ message, conversationId?, mode?: 'image', ratio?: '1:1'|'4:5'|'9:16', referenceImageId?: uuid, referenceImage?: dataUrl /*legacy*/, overlayText? }`
- `mode:'image'` means "the user turned image generation on": intent is forced to image, but the LLM STILL interprets the request (new image vs edit of an existing one).
Response (additive): `{ type, text, data, conversationId, messageId }`. For images:
`data: { jobId, ratio, kind:'generate'|'edit', parentImageId?: uuid, instruction?: string, summary: string }` (`summary` = one short sentence of what will be done, e.g. "Editing your last image: green background, hot drink").
Before the handler runs, the wrapper (stream 2) sets `req.convo = { id, history }` where `history` is the last 12 messages oldest to newest: `[{id, role, type, text(<=300 chars), data:{imageIds?:uuid[], ratio?, kind?, jobId?}, createdAt}]`. Image messages carry `data.imageIds` once the job finished (empty while pending). Stream 4 treats `req.convo` as possibly undefined.
Image job params that stream 4 enqueues (extra keys are passed through the queue untouched):
`{ prompt, ratio?, overlayText?, n:1, edit?: boolean, instruction?: string, referenceImageId?: uuid, referenceImage?: dataUrl, meta: { conversationId?, parentImageId?, kind:'generate'|'edit', prompt, instruction? } }`
Stream 3's worker resolves `referenceImageId` (owned by `userId`) to `referenceImage` BEFORE calling `generateImage`. If the id is missing/not owned the job FAILS with a clear error. It never silently generates without the reference. If `ratio` is absent on an edit, `generateImage` keeps the reference image's native aspect (no crop).

### 4.2 Image job polling (existing `GET /api/content/image/:jobId`), additive
`{status:'done', images:[dataUrl...], urls?:[...], imageIds:[uuid...]}` (`imageIds[i]` matches `images[i]`; produced by the worker's return value `{images, urls?, imageIds}`).

### 4.3 Image library. Stream 3.
- `GET /api/images?limit=40&before=<iso>&ids=<comma uuids, max 40>` -> `{images:[{id,kind,prompt,instruction,ratio,parentImageId,conversationId,createdAt,thumb:"data:image/jpeg;base64,..."}], next?:<iso>}`. With `ids`, return exactly those owned ids (batch thumbs).
- `GET /api/images/:id` -> `{id,kind,ratio,width,height,prompt,createdAt,dataUrl:"data:image/jpeg;base64,..."}` (full image)
- `POST /api/images/upload` body `{dataUrl}` (png/jpeg/webp, max 6 MB decoded, normalized with sharp, EXIF-rotated) -> 201 `{id,thumb,ratio}`; rate limit 30/hour.
- Library images persist until the account is deleted (FK cascade). There is deliberately no delete endpoint in v1.

### 4.4 Conversations. Stream 2.
- `GET /api/conversations?limit=30&before=<iso>` -> `{conversations:[{id,title,createdAt,updatedAt,lastMessage,messageCount,coverImageId?}], next?}` newest `updated_at` first.
- `POST /api/conversations {title?}` -> 201 `{id,title}`
- `GET /api/conversations/:id` -> `{id,title,messages:[{id,role,type,text,data,createdAt}]}` oldest to newest (max 300). Pending image messages (`data.jobId`, no `data.imageIds`) are resolved on read from `generated_images` by `job_id` (-> `data.imageIds`, `data.status:'done'`); still no row and the message is older than 10 minutes -> `data.status:'failed'`, `data.error:'Generation did not finish'`; otherwise `data.status:'pending'`.
- `PATCH /api/conversations/:id {title}` -> `{id,title}`; `DELETE /api/conversations/:id` -> 204 (hard delete, cascades messages).
- Title = first user message cut to 60 chars at a word boundary.
- Module exports `withConversation(store, handler)`: creates the conversation if `conversationId` is absent (or unknown/not owned: start a new one rather than fail), sets `req.convo`, runs the handler with `res.json` intercepted, and on a 2xx body saves the user message and the assistant message (`type,text,data`), bumps `updated_at`, adds `conversationId` and `messageId` to the body, then responds. Non-2xx responses store nothing. A persistence failure is logged and NEVER blocks the response.

### 4.5 Albums. Stream 5.
Item JSON: `{id,title,category,categorySource,status,caption,imageIds,ratio,folderId,conversationId,createdAt,updatedAt}`
- `POST /api/albums/items {title?,imageIds:[uuid] (1-10),caption?,ratio?,conversationId?,folderId?,status?,categoryHint?}` -> 201 `{item}`; auto-categorizes (see rules). Saving the same user's same cover image twice returns 200 `{item, existing:true}` (double-click safe).
- `GET /api/albums` -> `{albums:[{category,count,coverImageIds:[<=4]}] /*always all 5 categories, in order reel,photo,carousel,story,other*/, folders:[{id,name,count,coverImageIds}], total}`
- `GET /api/albums/items?category=&folderId=&status=&q=&limit=50&before=<iso>` -> `{items:[Item], next?}` (`folderId=none` = not in any folder)
- `GET /api/albums/items/:id` -> `{item}`
- `PATCH /api/albums/items/:id {title?,caption?,category?,folderId?|null,status?,imageIds?}` -> `{item}`. Setting `category` sets `categorySource:'user'`, and auto rules never touch that item again.
- `DELETE /api/albums/items/:id` -> 204
- `POST /api/albums/items/move {ids:[uuid],folderId?:uuid|null,category?}` -> `{moved:n}` (bulk organize)
- `POST /api/albums/folders {name}` -> 201 `{folder:{id,name}}` (duplicate name -> 409); `PATCH /api/albums/folders/:id {name}`; `DELETE /api/albums/folders/:id` -> 204 (items become unfiled, never deleted).
Categorize rules (pure function `categorize({ratio,imageCount,hint,text})`, the swap point for smarter logic): more than one image -> `carousel`; hint/text says story -> `story`; ratio `9:16` -> `reel`; `1:1` or `4:5` -> `photo`; otherwise `other`. If an LLM is configured (`llmConfig(uid)` from keys.js) it may refine ONLY when the rules give `other`, with a 5 s timeout, and any failure falls back to the rules.

### 4.6 Registrars. Each backend stream exports one function the integrator calls from routes.js:
`registerConversationRoutes({get,post,patch,del,q,limit})` (stream 2), `registerImageLibraryRoutes({get,post,patch,del,q,limit})` (stream 3), `registerAlbumRoutes({get,post,patch,del,q,limit})` (stream 5). Handlers are `(req,res)` async functions using `req.uid`; the helpers already wrap async errors.

### 4.7 Frontend contracts (no shared imports; each stream calls the API with its own client code through `api()` from web/src/api.ts)
- Deep links (hash): `#albums` opens the Albums page; `#settings` opens Settings; `#cc=<conversationId>` opens the Command Center on that conversation, optional `&ref=<imageId>` pre-selects that image as the edit reference. Stream 6 (App.tsx) switches the page; stream 1 (CommandCenter) reads the `#cc=` hash on mount and on `hashchange`, applies it, then clears it with `history.replaceState`. Both also react to `window` event `nav` by re-reading the hash.
- Image message UI data (what a rendered image message needs): `data:{imageIds:uuid[], status:'pending'|'done'|'failed', jobId?, ratio?, kind?, parentImageId?, instruction?, summary?, error?}`.
- Colors/spacing come from the existing CSS variables (`--bg --pn --bd --tx --mu --hv --bub --grad`), light and dark mode must both work. Instagram look, as the rest of the app.