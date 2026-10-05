import test from 'node:test';import assert from 'node:assert';import {encrypt,decrypt} from '../src/crypto.js';
test('api key encryption roundtrip',()=>{process.env.ENCRYPTION_KEY='ab'.repeat(32);const e=encrypt('sk-secret-1234');assert.notStrictEqual(e,'sk-secret-1234');assert.strictEqual(decrypt(e),'sk-secret-1234')});
test('tampered ciphertext is rejected',()=>{const b=Buffer.from(encrypt('x'),'base64');b[b.length-1]^=1;assert.throws(()=>decrypt(b.toString('base64')))});
