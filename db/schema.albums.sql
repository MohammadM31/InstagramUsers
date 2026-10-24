-- Albums ("phone album" of saved posts). Contract section 3.3. Idempotent: safe to run on every migrate.
-- image_ids and conversation_id are plain uuids on purpose (no foreign keys across streams).
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