// Shared by POST /api/content/image (Content AI) and the assistant's image intent (roadmap 0.8).
// Keeps the "is there a Replicate key?" check and the queue call in one place so the two paths cannot drift apart.
import { imageQ } from './queue.js';
import { keyFor } from './keys.js';
import { shrinkReference } from './images.js';

const envKey = () => process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;

export const hasReplicateKey = async uid => !!(await keyFor(uid, 'replicate', envKey()));

// Queues a generateImage job for this user and returns its id. Fails fast (503) if no key could ever succeed.
export async function enqueueImage(uid, params) {
  if (!await hasReplicateKey(uid)) throw Object.assign(new Error('No Replicate key: add one in Settings or set REPLICATE_API_TOKEN'), { status: 503 });
  let referenceImage = params?.referenceImage;
  if (typeof referenceImage === 'string' && referenceImage.startsWith('data:')) referenceImage = await shrinkReference(referenceImage);
  const job = await imageQ.add('generate', { userId: uid, params: { ...params, referenceImage: referenceImage || undefined } });
  return job.id;
}
