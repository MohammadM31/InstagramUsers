// Roadmap C.1: what the image worker returns. Deps are injected so this runs in tests without Redis, sharp or a bucket.
// Without storage the result is exactly what it was before: { images: [data URIs] }.
// With storage it is additive: { images, urls } where urls[i] is the public JPEG url of images[i]. A refused upload fails the job loudly
// (the person sees the error and can retry); it never hands back a data URI where a public url was promised.
export function makeProcessImage({ generate, storage, track, prefix = 'img' }) {
  return async function processImage({ userId, params }) {
    const images = await generate({ ...params, uid: userId });
    if (!storage || !storage.enabled) return { images };
    const urls = [];
    for (const d of images) {
      const m = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(String(d));
      if (!m) throw new Error('Image result was not a data URI, so it cannot be uploaded');
      const url = await storage.uploadImage(Buffer.from(m[2], 'base64'), m[1], prefix);
      if (track) { // record the object (stored_images). If that fails the object would be unlisted, so remove it and fail the job.
        try { await track(userId, url); }
        catch (e) { await storage.deleteImage(url).catch(() => {}); throw new Error('The image was uploaded but could not be recorded, so it was removed: ' + e.message); }
      }
      urls.push(url);
    }
    return { images, urls };
  };
}
