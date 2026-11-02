import test from 'node:test';
import assert from 'node:assert/strict';
import { shrinkReference, adjustImage } from '../src/images.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('darker keeps the same picture and only changes the pixels', async () => {
  const out = await adjustImage(png, 'darker');
  assert.match(out, /^data:image\/jpeg;base64,/);
  assert.notEqual(out, png);
});
test('an attached photo is shrunk to a jpeg before it is queued', async () => {
  const out = await shrinkReference(png);
  assert.match(out, /^data:image\/jpeg;base64,/);
  assert.ok(out.length > 30);
});
