const test = require('node:test');
const assert = require('node:assert/strict');

const { parseTrackedChannels, shouldTrack, messageStats } = require('../tracking.js');

function fakeMessage({ bot = false, channelId = '111', content = 'hello' } = {}) {
  return {
    author: { bot, tag: 'someone#0001' },
    channel: { id: channelId, name: 'general' },
    content,
  };
}

test('parses a comma-separated channel list, tolerating whitespace and blanks', () => {
  assert.deepEqual(parseTrackedChannels(' 111, 222 ,,333 '), ['111', '222', '333']);
});

test('an unset or empty channel list parses to empty', () => {
  assert.deepEqual(parseTrackedChannels(undefined), []);
  assert.deepEqual(parseTrackedChannels(''), []);
  assert.deepEqual(parseTrackedChannels('  ,  '), []);
});

test('tracks nothing when no channels are configured (opt-in, not opt-out)', () => {
  assert.equal(shouldTrack(fakeMessage(), []), false,
    'an unconfigured bot must not log every message in every channel');
});

test('tracks a message in an allowed channel', () => {
  assert.equal(shouldTrack(fakeMessage({ channelId: '222' }), ['111', '222']), true);
});

test('ignores a message outside the allowlist', () => {
  assert.equal(shouldTrack(fakeMessage({ channelId: '999' }), ['111', '222']), false);
});

test('always ignores bot messages, even in an allowed channel', () => {
  assert.equal(shouldTrack(fakeMessage({ bot: true, channelId: '111' }), ['111']), false,
    'replying to bots is how feedback loops start');
});

test('counts words and characters', () => {
  assert.deepEqual(messageStats('hello brave world'), { charCount: 17, wordCount: 3, lookingForGroup: false });
});

test('collapses runs of whitespace when counting words', () => {
  assert.equal(messageStats('  a   b  ').wordCount, 2);
});

test('an empty message counts as zero words, not one', () => {
  assert.deepEqual(messageStats(''), { charCount: 0, wordCount: 0, lookingForGroup: false });
});

test('flags lfg case-insensitively', () => {
  assert.equal(messageStats('anyone LFG?').lookingForGroup, true);
  assert.equal(messageStats('lfg').lookingForGroup, true);
  assert.equal(messageStats('nothing here').lookingForGroup, false);
});
