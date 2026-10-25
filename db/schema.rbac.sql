-- R.0 platform foundations (roles, audit log, plans, usage, flags, moderation). Idempotent: `npm run migrate` can run it any number of times.
-- Organizations, memberships and org_id columns come in R.0b; usage_events gets its org_id there.

-- Platform role and account state. The default is a plain customer; nothing in a request path grants admin or owner (see src/rbac/bootstrap.js).
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','support','admin','owner'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 0;   -- bumped to sign a person out everywhere
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

-- Append-only audit trail. No foreign keys on purpose: deleting a user must not touch (and the trigger would refuse) a row here.
CREATE TABLE IF NOT EXISTS audit_log(
 id bigserial PRIMARY KEY,
 actor_id uuid, actor_role text,
 org_id uuid,                                  -- R.0b adds organizations; plain uuid until then
 action text NOT NULL, target_type text, target_id text,
 before jsonb, after jsonb, meta jsonb, ip text,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS audit_log_actor ON audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_org ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log(created_at DESC);
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege'; END $$;
DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- Plans: daily limits, NULL = unlimited. Re-running never overwrites limits an admin has changed.
CREATE TABLE IF NOT EXISTS plans(name text PRIMARY KEY, daily_images int, daily_chat int, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO plans(name,daily_images,daily_chat) VALUES ('free',5,30),('pro',50,300),('unlimited',NULL,NULL) ON CONFLICT (name) DO NOTHING;

-- One row per metered action. R.0b adds org_id.
CREATE TABLE IF NOT EXISTS usage_events(
 id bigserial PRIMARY KEY,
 user_id uuid REFERENCES users ON DELETE CASCADE,
 kind text NOT NULL, units int NOT NULL DEFAULT 1, cost_estimate_usd numeric(12,6), provider text, meta jsonb,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS usage_events_user ON usage_events(user_id, created_at);

-- Kill switches and the announcement banner (read through src/flags.js).
CREATE TABLE IF NOT EXISTS feature_flags(key text PRIMARY KEY, value jsonb, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO feature_flags(key,value) VALUES ('ai_enabled','true'),('image_generation_enabled','true'),('maintenance_mode','false'),('announcement','null') ON CONFLICT (key) DO NOTHING;

-- Moderation columns on the image tables. stored_images (C.1) is the image table in this repo; generated_images (the image library) gets the
-- same columns when it exists, so this file works before and after that table is created.
ALTER TABLE stored_images ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'ok';
ALTER TABLE stored_images ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE stored_images ADD COLUMN IF NOT EXISTS removed_by uuid;
ALTER TABLE stored_images ADD COLUMN IF NOT EXISTS removed_reason text;
DO $$ BEGIN
 IF to_regclass('generated_images') IS NOT NULL THEN
  ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'ok';
  ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS removed_at timestamptz;
  ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS removed_by uuid;
  ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS removed_reason text;
 END IF;
END $$;
