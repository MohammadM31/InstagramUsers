import test from 'node:test';
import assert from 'node:assert/strict';
import { captionFromPage, localOpinion, aboutCurrentWork, wantsSchedule, clockFromText, albumAsk, affirmsCreate, categoryNamed } from '../src/pageactions.js';

const page = { name: 'Posts', prompt: 'iced coffee', ratio: '4:5', captions: [{ hook: 'Cold brew', body: 'Monday fuel', cta: 'Tag a friend' }], tags: { niche: ['coffee', '#cafe'] }, imageCount: 1 };

test('caption joins the latest caption and the tags', () => {
  assert.match(captionFromPage(page), /Cold brew/);
  assert.match(captionFromPage(page), /#coffee #cafe/);
});
test('opinion names the prompt, caption and tags that are actually on the page', () => {
  const t = localOpinion(page);
  assert.match(t, /iced coffee/); assert.match(t, /Cold brew/); assert.match(t, /#?coffee/);
  assert.match(localOpinion({ name: 'Posts' }), /Nothing has been generated/);
});
test('commands: schedule, template folder, reels album, and a yes after the question', () => {
  assert.equal(aboutCurrentWork('what do you think of the current generation and tags'), true);
  assert.equal(aboutCurrentWork('how am I doing?'), false);
  assert.equal(wantsSchedule('take these generations create a post in the background with the tags and schedule it to 1pm today'), true);
  assert.equal(wantsSchedule('what should I post next'), false);
  assert.deepEqual(albumAsk('save the last image to the templates album'), { kind: 'folder', name: 'Templates' });
  assert.deepEqual(albumAsk('save it to the reels album'), { kind: 'category', category: 'reel' });
  assert.equal(albumAsk('what do you think'), null);
  assert.equal(affirmsCreate('yes, create it'), true);
  assert.equal(affirmsCreate('how am I doing'), false);
  assert.equal(categoryNamed('put it in reels'), 'reel');
});
test('1pm today is 13:00 on the same calendar day', () => {
  const iso = clockFromText('schedule it for 1pm today', new Date('2026-11-01T09:00:00'));
  const d = new Date(iso);
  assert.equal(d.getHours(), 13);
  assert.equal(d.getDate(), 1);
});
