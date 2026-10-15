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

-- ===== Phase 1 / 2.1 (idempotent) =====
-- 2.1 daily snapshots: one row per post per UTC day. History accumulates only while the worker runs.
CREATE TABLE IF NOT EXISTS post_snapshots(id serial PRIMARY KEY,post_id int NOT NULL REFERENCES posts ON DELETE CASCADE,captured_at timestamptz NOT NULL DEFAULT now(),likes int,comments int,saves int,shares int,reach int);
CREATE INDEX IF NOT EXISTS post_snapshots_post_time ON post_snapshots(post_id,captured_at);
CREATE UNIQUE INDEX IF NOT EXISTS post_snapshots_day ON post_snapshots(post_id,((captured_at AT TIME ZONE 'UTC')::date));
-- 2.1 baseline: the user's numbers the first time the worker saw them, so the first day does not look like a sudden change.
CREATE TABLE IF NOT EXISTS metrics_baseline(user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,captured_at timestamptz NOT NULL DEFAULT now(),reach30d int,er numeric,best_post_er numeric,posts30d int);

-- ===== Phase 2 (idempotent) =====
-- 2.3 notifications. dedupe_key makes every alert fire once (per day/week/post), however often the hourly job runs.
ALTER TABLE metrics_baseline ADD COLUMN IF NOT EXISTS ahead text[]; -- competitors that were already ahead of the user when baselined (NULL = not baselined yet)
CREATE TABLE IF NOT EXISTS notifications(id serial PRIMARY KEY,user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,kind text NOT NULL,title text NOT NULL,body text NOT NULL,watch text,dedupe_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz,UNIQUE(user_id,dedupe_key));
CREATE INDEX IF NOT EXISTS notifications_user_time ON notifications(user_id,created_at DESC);

-- ===== Phase A.1 (idempotent) =====
-- A.1a one Instagram account per user (decision D4: a separate table so more can be allowed later). The access token is NOT here:
-- it stays encrypted in api_keys under the name 'instagram'.
CREATE TABLE IF NOT EXISTS ig_accounts(user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,ig_user_id text NOT NULL,page_id text,username text,account_type text,scopes text[] DEFAULT '{}',token_expires_at timestamptz,status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','reconnect_needed','disconnected')),followers_at_connect int,last_sync_at timestamptz,last_error text,connected_at timestamptz NOT NULL DEFAULT now());
-- A.1b posts gain Instagram identity + the metrics the API adds. Unavailable metrics stay NULL (never rejected, never faked as 0).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS ig_media_id text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS permalink text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS thumbnail_url text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS views int;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_product_type text;
CREATE UNIQUE INDEX IF NOT EXISTS posts_ig_media ON posts(user_id,ig_media_id) WHERE ig_media_id IS NOT NULL;

-- ===== Phase A.1c / A.1d (idempotent) =====
-- A.1d: Meta's deauthorize and data-deletion callbacks identify a person only by their Facebook user id, so the account row keeps it.
ALTER TABLE ig_accounts ADD COLUMN IF NOT EXISTS fb_user_id text;
CREATE INDEX IF NOT EXISTS ig_accounts_fb_user ON ig_accounts(fb_user_id) WHERE fb_user_id IS NOT NULL;
-- A.1c follower history: one row per user per UTC day. followers = total that day; net_new = Instagram's daily follower_count (NULL under 100 followers).
-- source: 'live' (read from the profile at sync time) or 'reconstructed' (walked back from today's total using the daily net change).
CREATE TABLE IF NOT EXISTS follower_history(id serial PRIMARY KEY,user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,captured_at timestamptz NOT NULL DEFAULT now(),followers int,net_new int,source text NOT NULL DEFAULT 'live');
CREATE UNIQUE INDEX IF NOT EXISTS follower_history_day ON follower_history(user_id,((captured_at AT TIME ZONE 'UTC')::date));
-- A.1c account-level daily numbers (unavailable = NULL, never 0)
CREATE TABLE IF NOT EXISTS ig_account_daily(user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,day date NOT NULL,reach int,views int,accounts_engaged int,profile_links_taps int,follows int,unfollows int,UNIQUE(user_id,day));
-- A.1c weekly audience snapshot (needs 100+ followers)
CREATE TABLE IF NOT EXISTS ig_audience(id serial PRIMARY KEY,user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,captured_at timestamptz NOT NULL DEFAULT now(),demographics jsonb,online_followers jsonb);
CREATE UNIQUE INDEX IF NOT EXISTS ig_audience_week ON ig_audience(user_id,((date_trunc('week',captured_at AT TIME ZONE 'UTC'))::date));
-- A.1d persisted Dismiss for Today's Priorities (key = the tip kind). Hidden until `until`.
CREATE TABLE IF NOT EXISTS priority_dismissals(user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,tip_key text NOT NULL,until timestamptz NOT NULL,PRIMARY KEY(user_id,tip_key));
-- A.1d data-deletion requests from Meta. Only a hash of the Facebook user id is stored, never the id itself, and no user_id (the user's rows are gone).
CREATE TABLE IF NOT EXISTS ig_deletion_requests(code text PRIMARY KEY,fb_hash text NOT NULL,status text NOT NULL,detail text,requested_at timestamptz NOT NULL DEFAULT now());
-- O.1 business profile + onboarding progress (one row per user). Created inside a guard so the one-time backfill below runs ONLY when the table is first
-- created: users that already exist then are marked complete (never forced through onboarding); users who register later get no row until they start it.
DO $$ BEGIN
  IF to_regclass('public.business_profile') IS NULL THEN
    CREATE TABLE business_profile(user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,display_name text,business_name text,role text,timezone text,languages text[],
      business_summary text,offerings text[],niche text,niche_keywords text[],audience text,stage text,goal_primary text,goal_secondary text,goal_target_metric text,
      goal_target_value numeric,goal_baseline_value numeric,goal_deadline date,posts_per_week int,content_by text,video_ok boolean,auto_proposals boolean NOT NULL DEFAULT false,
      onboarding_step text NOT NULL DEFAULT 'about',skipped_steps text[] NOT NULL DEFAULT '{}',completed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO business_profile(user_id,onboarding_step,completed_at) SELECT id,'done',now() FROM users;
  END IF;
END $$;
