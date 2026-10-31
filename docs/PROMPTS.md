# Agent prompts

Shared board for this repo. One file, many agents. Each prompt has a permanent ID. An agent works exactly one prompt: the ID it was given, or, if it was given none, the next open prompt in access order.

These four prompts are mocks. Their status is `sample`. Do not claim them and do not implement them. Copy a section, give it a new ID, and set `status: open` when you want real work done.

Repo: GrowthEngine (`InstagramUsers`). Express + Postgres + Redis/BullMQ, React in `web/`.

## How an agent picks its prompt

Read this file before editing anything.

**Permanent ID.** The human names the ID in the chat message. That agent owns that section and no other.

```
Read docs/PROMPTS.md. Your permanent id is P-002. Work only that prompt.
```

**Order of access.** The human does not name an ID. Agents then take prompts from lowest `access_order` to highest, but only when `status` is `open`.

```
Read docs/PROMPTS.md. You were not given an id. Claim the next open prompt in access order.
```

`access_order` is only a queue. The permanent ID never changes and never gets reused. A finished prompt stays in the file with `status: done`. The next real prompt gets the next free ID (`P-005`, then `P-006`).

### Claim, when no ID was given

Two agents can open this file at the same moment. Settle it in the file, not in chat.

1. Find the lowest `access_order` whose `status` is `open`. Skip `sample`, `claimed`, `in_progress`, `blocked`, and `done`.
2. Set `status: claimed`, set `owner` to a short token you just made (letters and digits, 6–10 characters), and set `claimed_at` to the current UTC time.
3. Read the file again. If `owner` is your token, you won. Set `status: in_progress` and start.
4. If `owner` is someone else, you lost. Leave their section alone and try the next `open` prompt.
5. If nothing is `open`, stop and say so. Do not invent a task.

An agent that was given a permanent ID skips the race. It sets `owner` and `status: in_progress` on that section only. If that section is not `open`, it stops and reports the status it found.

### While you work

- Edit only the files listed under `owns`. If you need a change in a file another prompt owns, finish your own work and write one line under `handoff`.
- Do not change another prompt's text, status, or owner.
- When you finish, set `status: done`, fill `report`, and leave the section in place.
- If you are blocked, set `status: blocked` and write the blocker under `report`. Do not take a second prompt to get around it.
- Never commit secrets. Queries that read user data stay scoped to the authenticated user.

### Status values

| Status | Meaning |
|---|---|
| `sample` | Mock text. Not work. Not claimable. |
| `open` | Waiting for an agent. |
| `claimed` | An agent is in the short race window above. |
| `in_progress` | Owner is working. |
| `blocked` | Owner stopped. See `report`. |
| `done` | Finished. See `report`. |

## Board

| ID | Access order | Status | Owner | Title |
|---|---|---|---|---|
| P-001 | 1 | sample | — | Mock: read-only map of the assistant route |
| P-002 | 2 | sample | — | Mock: note how image jobs expire |
| P-003 | 3 | sample | — | Mock: list album hash links |
| P-004 | 4 | sample | — | Mock: name the test command for one file |

## P-001

```
id: P-001
access_order: 1
status: sample
owner:
claimed_at:
title: Mock — read-only map of the assistant route
owns:
  - docs/PROMPTS.md (this section's report only)
does_not_touch:
  - src/**
  - web/**
  - test/**
goal: >
  Example only. Show the shape of a prompt that asks for a short
  written map and forbids code changes.
```

Mock prompt:

Write a short map of `POST /api/assistant`: which file handles it, what the handler returns, and where image mode is decided. Read those files. Do not edit them. Put the map in `report` below, in plain sentences. If a line in the code and a line in `docs/parallel/Contract.md` disagree, quote both and say which one you treated as current.

```
report:
handoff:
```

## P-002

```
id: P-002
access_order: 2
status: sample
owner:
claimed_at:
title: Mock — note how image jobs expire
owns:
  - docs/PROMPTS.md (this section's report only)
does_not_touch:
  - src/**
  - web/**
goal: >
  Example only. A second agent can run this at the same time as P-001
  because the two prompts share no files.
```

Mock prompt:

Read the image job path (`src/imagejobs.js`, `src/worker.js`, and the image notes in the README). In `report`, say how long a finished job result stays available and what the client does when polling stops. Do not change retention, queue names, or any source file. If you cannot tell the TTL from the code, write `unknown` and the file you checked.

```
report:
handoff:
```

## P-003

```
id: P-003
access_order: 3
status: sample
owner:
claimed_at:
title: Mock — list album hash links
owns:
  - docs/PROMPTS.md (this section's report only)
does_not_touch:
  - src/**
  - web/**
goal: >
  Example only. Permanent ID P-003, access order 3.
  A human can assign this ID directly, or an agent with no ID
  can claim it only after P-001 and P-002 are no longer open.
```

Mock prompt:

From `docs/parallel/Contract.md` section 4.7 and `web/src/App.tsx`, list the hash links that open a page (`#albums`, `#settings`, `#cc=`, and any others you find). Say which file actually switches the page. Do not add a route and do not edit the app. Record the list in `report`.

```
report:
handoff:
```

## P-004

```
id: P-004
access_order: 4
status: sample
owner:
claimed_at:
title: Mock — name the test command for one file
owns:
  - docs/PROMPTS.md (this section's report only)
does_not_touch:
  - package.json
  - test/**
goal: >
  Example only. Shows a prompt whose done condition is a command,
  not a code change.
```

Mock prompt:

Look at `package.json` and `docs/parallel/Contract.md`. In `report`, give the exact command to run one test file (`node --test test/<file>.test.js`) and the command that runs the full suite (`npm test`). Do not run the suite, do not add a dependency, and do not edit `package.json`.

```
report:
handoff:
```

## Blank prompt

Copy from `id:` through `handoff:` to add real work. Use the next free permanent ID. Set `status: open`. Set `access_order` to one more than the highest order already on the board, then add a row to the board table.

```
id: P-00N
access_order: N
status: open
owner:
claimed_at:
title:
owns:
  -
does_not_touch:
  -
goal: >

report:
handoff:
```

Prompt text goes between the `goal` block and the `report` block, as in the samples above.
