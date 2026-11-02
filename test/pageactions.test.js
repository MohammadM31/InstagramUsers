import test from 'node:test';
import assert from 'node:assert/strict';
import { captionFromPage, localOpinion, ignoredWork, aboutCurrentWork, wantsSchedule, clockFromText, albumAsk, folderCreate, affirmsCreate, categoryNamed, wantsGeneratedImage, imageRequestPrompt, imageAdjust } from '../src/pageactions.js';

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
  assert.deepEqual(albumAsk('save the last image generated to the reels album'), { kind: 'category', category: 'reel' });
  assert.deepEqual(albumAsk('save it to an album named template'), { kind: 'folder', name: 'template' });
  assert.deepEqual(albumAsk('put this photo into the reference album'), { kind: 'folder', name: 'Reference' });
  assert.deepEqual(albumAsk('put this photo into the photos album'), { kind: 'category', category: 'photo' });
  assert.equal(albumAsk('what do you think'), null);
  assert.equal(ignoredWork('Instagram tool does not support creating albums.', page), true);
  assert.equal(ignoredWork('The coffee caption is clear and the cafe tag fits the image.', page), false);
  assert.equal(albumAsk('create an album named template in Albums tabs'), null);
  assert.deepEqual(folderCreate('create an album named template in Albums tabs'), { name: 'template' });
  assert.deepEqual(folderCreate('create a template folder'), { name: 'Templates' });
  assert.deepEqual(folderCreate('make a folder called Brand shots'), { name: 'Brand shots' });
  assert.equal(folderCreate('create a post'), null);
  assert.equal(folderCreate('save it to the reels album'), null);
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
test('darker changes the current image and does not ask for a new one', () => {
  assert.equal(imageAdjust('make the image a bit darker'), 'darker');
  assert.equal(imageAdjust('generate an image of a darker cafe'), null);
  assert.equal(imageAdjust('what do you think of the tags'), null);
});
test('an attached photo is a generation, not a tip about having no posts', () => {
  const said = 'generate an image referenced from this attached image';
  assert.equal(wantsGeneratedImage(said), true);
  assert.equal(wantsGeneratedImage('what do you think of the current generation and tags'), false);
  assert.equal(wantsGeneratedImage('create an album named template'), false);
  assert.equal(imageRequestPrompt(said, true), 'Create a polished Instagram post from the attached photo. Keep the subject recognizable.');
  assert.equal(imageRequestPrompt('generate an image of a red cup', false), 'a red cup');
});
test('a clock time that has already passed moves to tomorrow', () => {
  const iso = clockFromText('schedule it for 1pm today', new Date('2026-11-01T15:00:00'));
  const d = new Date(iso);
  assert.equal(d.getHours(), 13);
  assert.equal(d.getDate(), 2);
});
