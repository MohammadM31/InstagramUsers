CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text UNIQUE NOT NULL,pass_hash text NOT NULL,tos_accepted_at timestamptz NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS api_keys(user_id uuid REFERENCES users ON DELETE CASCADE,name text,enc text NOT NULL,PRIMARY KEY(user_id,name));
CREATE TABLE IF NOT EXISTS posts(id serial PRIMARY KEY,user_id uuid REFERENCES users ON DELETE CASCADE,type text,posted_at timestamptz,likes int,comments int,saves int,shares int,reach int,impressions int,watch_s int,caption text);
CREATE TABLE IF NOT EXISTS competitors(id serial PRIMARY KEY,user_id uuid REFERENCES users ON DELETE CASCADE,handle text NOT NULL,followers int,last_scraped timestamptz,UNIQUE(user_id,handle));
CREATE TABLE IF NOT EXISTS competitor_posts(id serial PRIMARY KEY,competitor_id int REFERENCES competitors ON DELETE CASCADE,type text,posted_at timestamptz,likes int,comments int,caption text,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS scrape_audit(id serial PRIMARY KEY,user_id uuid REFERENCES users ON DELETE CASCADE,handle text,source text,disclaimer text,at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS hashtag_sets(id serial PRIMARY KEY,user_id uuid REFERENCES users ON DELETE CASCADE,name text,tags text[]);
CREATE TABLE IF NOT EXISTS scheduled_posts(id serial PRIMARY KEY,user_id uuid REFERENCES users ON DELETE CASCADE,caption text NOT NULL,image text,platforms text[] DEFAULT '{instagram}',scheduled_at timestamptz NOT NULL,status text DEFAULT 'scheduled',error text,published_at timestamptz);

-- ===== Phase 0 (idempotent: migrate.js re-runs this whole file) =====
-- 0.1 post import: one-time dedupe so the unique index can be created on databases that already hold duplicates, then the index.
DELETE FROM posts a USING posts b WHERE a.id>b.id AND a.user_id=b.user_id AND a.posted_at IS NOT DISTINCT FROM b.posted_at AND a.type IS NOT DISTINCT FROM b.type AND md5(coalesce(a.caption,''))=md5(coalesce(b.caption,''));
CREATE UNIQUE INDEX IF NOT EXISTS posts_dedupe ON posts(user_id,posted_at,type,md5(coalesce(caption,'')));
CREATE INDEX IF NOT EXISTS posts_user_time ON posts(user_id,posted_at DESC);
CREATE TABLE IF NOT EXISTS import_log(id serial PRIMARY KEY,user_id uuid REFERENCES users ON DELETE CASCADE,source text NOT NULL,imported int NOT NULL,duplicates int NOT NULL,invalid int NOT NULL DEFAULT 0,at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS import_log_user ON import_log(user_id,at DESC);
-- extra: hot-path indexes that were missing
CREATE INDEX IF NOT EXISTS competitor_posts_comp ON competitor_posts(competitor_id,posted_at DESC);
CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled_posts(status,scheduled_at);
