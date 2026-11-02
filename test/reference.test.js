import test from 'node:test';
import assert from 'node:assert/strict';
import { shrinkReference } from '../src/images.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('an attached photo is shrunk to a jpeg before it is queued', async () => {
  const out = await shrinkReference(png);
  assert.match(out, /^data:image\/jpeg;base64,/);
  assert.ok(out.length > 30);
});
