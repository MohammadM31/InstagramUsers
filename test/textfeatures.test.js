import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractHashtags, extractMentions, captionFeatures, countEmoji, tagBlockType,
} from '../src/textfeatures.js';

test('Arabic and mixed tags', () => {
  assert.deepEqual(extractHashtags('صباح الخير #بيروت #لبنان'), ['بيروت', 'لبنان']);
  assert.deepEqual(extractHashtags('hi #Beirut_بيروت'), ['beirut_بيروت']);
});
test('Arabic diacritics are kept inside the tag', () => {
  assert.deepEqual(extractHashtags('#مَرْحَبًا'), ['مَرْحَبًا']);
});
test('accents and case', () => {
  assert.deepEqual(extractHashtags('#Café #CAFÉ #café'), ['café']);
});
test('fullwidth hash is normalized (NFKC)', () => {
  assert.deepEqual(extractHashtags('＃Beirut'), ['beirut']);
});
test('emoji next to tags', () => {
  assert.deepEqual(extractHashtags('🔥#fire #sun☀️ #wave🌊#sea'), ['fire', 'sun', 'wave', 'sea']);
});
test('pure numbers ignored, mixed kept', () => {
  assert.deepEqual(extractHashtags('#1 #2024 #_ #2024goals #top10'), ['2024goals', 'top10']);
});
test('URL fragments ignored', () => {
  assert.deepEqual(extractHashtags('see https://x.com/a#frag and www.y.com/p#sec #real'), ['real']);
});
test('glued tags', () => {
  assert.deepEqual(extractHashtags('#a#b#c'), ['a', 'b', 'c']);
});
test('hash inside a word is not a tag', () => {
  assert.deepEqual(extractHashtags('abc#def C#'), []);
});
test('30 tag cap and custom max', () => {
  const cap = Array.from({ length: 40 }, (_, i) => `#t${i}`).join(' ');
  assert.equal(extractHashtags(cap).length, 30);
  assert.equal(extractHashtags(cap, { max: 5 }).length, 5);
});
test('null and empty input', () => {
  assert.deepEqual(extractHashtags(null), []);
  assert.deepEqual(extractHashtags(''), []);
  assert.equal(captionFeatures(undefined).length, 0);
});
test('mentions', () => {
  assert.deepEqual(extractMentions('thanks @Foo.Bar and @baz_1. mail a@b.com'), ['foo.bar', 'baz_1']);
});
test('emoji count incl. flags', () => {
  assert.equal(countEmoji('hi 🔥🔥 🇱🇧 1'), 3);
});
test('tag block position', () => {
  assert.equal(tagBlockType('no tags'), 'none');
  assert.equal(tagBlockType('I love #beirut so much'), 'inline');
  assert.equal(tagBlockType('Nice day\n\n#a #b #c'), 'trailing');
  assert.equal(tagBlockType('I love #beirut\n\n#a #b'), 'mixed');
});
test('caption features', () => {
  const f = captionFeatures('Which one? 😍\nLink in bio!\n#a #b');
  assert.equal(f.lineCount, 3);
  assert.equal(f.hasQuestion, true);
  assert.equal(f.hasCta, true);
  assert.equal(f.emojiCount, 1);
  assert.equal(f.tagCount, 2);
  assert.equal(f.tagBlock, 'trailing');
});
test('Arabic question mark and CTA', () => {
  const f = captionFeatures('هل جربتم؟ تابعنا');
  assert.equal(f.hasQuestion, true);
  assert.equal(f.hasCta, true);
});
