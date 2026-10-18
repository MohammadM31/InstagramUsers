// Roadmap C.1 follow-up (decision 97): every image uploaded to the bucket is recorded here, so it can be listed (GDPR export), removed
// (account delete, retention, after publish) and never forgotten. I/O only; deps injected: q (db), storage (storage.js), now.
// The row's user_id is SET NULL when the account is deleted (not cascaded): the bucket object may still exist, and the purge job needs the key
// to finish the deletion. A row with no user is just an object key (random name, no personal data) waiting to be deleted.
export const DEFAULT_RETENTION_DAYS = 30;

// IMAGE_RETENTION_DAYS: whole days, 1-365, default 30. A bad value is a boot error (config.js), not a silent default.
export function retentionDays(env = process.env) {
  const raw = String(env.IMAGE_RETENTION_DAYS ?? '').trim();
  if (!raw) return { days: DEFAULT_RETENTION_DAYS, problem: null };
  const n = Number(raw);
  if (!/^\d{1,3}$/.test(raw) || n < 1 || n > 365) return { days: DEFAULT_RETENTION_DAYS, problem: `IMAGE_RETENTION_DAYS must be a whole number of days from 1 to 365 (got "${raw.slice(0, 20)}")` };
  return { days: n, problem: null };
}

const INSERT = 'INSERT INTO stored_images(user_id,object_key) VALUES($1,$2) ON CONFLICT (object_key) DO NOTHING RETURNING id';
const DUE = `SELECT id,object_key FROM stored_images WHERE deleted_at IS NULL AND (user_id IS NULL OR created_at < now() - make_interval(days=>$1)) ORDER BY created_at LIMIT $2`;
const MINE = 'SELECT id,object_key FROM stored_images WHERE user_id=$1 AND deleted_at IS NULL ORDER BY id';
const ONE = 'SELECT id,object_key FROM stored_images WHERE user_id=$1 AND object_key=$2 AND deleted_at IS NULL';
const MARK = 'UPDATE stored_images SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL';

export function makeStoredImages({ q, storage, env = process.env }) {
  const days = () => retentionDays(env).days;
  // Remove the bucket object, then mark the row. A failed delete leaves the row alone so the next pass retries it.
  async function removeRows(rows) {
    const out = { total: rows.length, removed: 0, errors: 0, firstError: null };
    for (const r of rows) {
      try { await storage.deleteImage(r.object_key); await q(MARK, [r.id]); out.removed++; }
      catch (e) { out.errors++; out.firstError ||= String(e.message).slice(0, 200); }
    }
    return out;
  }
  return {
    // Called right after an upload. The unique key makes a repeat harmless.
    async record(userId, key) { await q(INSERT, [userId, key]); },
    async recordUrl(userId, url) {
      const key = storage.keyFromUrl(url);
      if (!key) throw new Error('Not an image url created by this storage, so it cannot be tracked');
      await q(INSERT, [userId, key]);
      return key;
    },
    // Hourly job. Deletes objects older than the retention period and any object whose account is gone.
    // Storage switched off while images are still stored is an error (they cannot be deleted); with nothing due it is quiet.
    async purgeDue({ max = 100 } = {}) {
      const rows = await q(DUE, [days(), max]);
      if (!rows.length) return { total: 0, removed: 0, errors: 0, firstError: null };
      if (!storage?.enabled) throw new Error(`Image storage is not configured, so ${rows.length} stored image(s) due for deletion cannot be removed (set the S3_* variables again)`);
      return removeRows(rows);
    },
    // Account delete: try to remove this user's objects now. Never throws (it must not block the account deletion); whatever fails stays
    // listed with user_id NULL after the cascade and the hourly purge finishes it.
    async purgeUser(userId) {
      let rows;
      try { rows = await q(MINE, [userId]); } catch (e) { return { total: 0, removed: 0, pending: 0, errors: 1, firstError: String(e.message).slice(0, 200) }; }
      if (!rows.length) return { total: 0, removed: 0, pending: 0, errors: 0, firstError: null };
      if (!storage?.enabled) return { total: rows.length, removed: 0, pending: rows.length, errors: 0, firstError: 'storage_not_configured' };
      const r = await removeRows(rows);
      return { ...r, pending: r.total - r.removed };
    },
    // C.2 hook: after Instagram has published, the source object is no longer needed. Only the owner's own, still-present object is deleted.
    // Returns { released, reason }; a delete that fails keeps the row, so the retention job removes it later.
    async releaseAfterPublish(userId, urlOrKey) {
      const key = storage?.enabled ? storage.keyFromUrl(urlOrKey) : null;
      if (!key) return { released: false, reason: storage?.enabled ? 'not_ours' : 'storage_not_configured' };
      const [row] = await q(ONE, [userId, key]);
      if (!row) return { released: false, reason: 'not_found' };
      const r = await removeRows([row]);
      return r.removed ? { released: true, reason: null } : { released: false, reason: 'delete_failed', error: r.firstError };
    },
  };
}
