// Wires the Instagram modules to the real database, Redis and queue. routes.js, server.js and worker.js import from here,
// so there is exactly one graph client, one key adapter and one getIgCreds.
import { q } from './db.js';
import { redis } from './cache.js';
import { encrypt } from './crypto.js';
import { getUserKey } from './keys.js';
import { hit } from './ratelimit.js';
import { igsyncQ } from './queue.js';
import { runSnapshots } from './snapshots.js';
import { makeGraph } from './instagram.js';
import { makeIgConnect, makeIgCreds, makeRedisState } from './igconnect.js';
import { makeIgSync } from './igsync.js';
import { makeIgAccount } from './igaccount.js';
import { makeCompliance } from './igcompliance.js';
import { makeDismissals } from './dismissals.js';

export const graph = makeGraph();
export const keys = {
  get: getUserKey,
  set: (uid, name, value) => q('INSERT INTO api_keys(user_id,name,enc) VALUES($1,$2,$3) ON CONFLICT(user_id,name) DO UPDATE SET enc=$3', [uid, name, encrypt(value)]),
  del: (uid, name) => q('DELETE FROM api_keys WHERE user_id=$1 AND name=$2', [uid, name]),
};
export const getIgCreds = makeIgCreds({ q, keys });
export const igConnect = makeIgConnect({ q, graph, state: makeRedisState(redis), keys });
export const igSync = makeIgSync({
  q, graph, getIgCreds, hit, account: makeIgAccount({ q, graph }),
  afterSync: () => runSnapshots(q),
  enqueue: async uid => (await igsyncQ.add('igsync', { userId: uid }, { attempts: 1 })).id,
  getJob: id => igsyncQ.getJob(id),
});
export const compliance = makeCompliance({ q, keys });
export const dismissals = makeDismissals({ q });
