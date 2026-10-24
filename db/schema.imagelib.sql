-- Persistent image library (parallel contract section 3.2). Idempotent: safe to run on every migrate.
-- Library images live until the account is deleted (ON DELETE CASCADE). They do NOT depend on the bucket retention purge.
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