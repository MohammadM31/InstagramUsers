-- Stream 2 (history-api): Command Center conversations. Idempotent: migrate.js re-runs it. Contract section 3.1.
-- No foreign keys to other streams' tables (image ids live inside the `data` jsonb as plain uuid strings).
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