const test = require('node:test');
const assert = require('node:assert/strict');

const { ChannelHistory, MAX_PAIRS } = require('../chat/history.js');
const { STORED_ANSWER_CHARS } = require('../chat/format.js');

const SYSTEM = 'You are a bot.';

function build(history, channelId, overrides = {}) {
  return history.build(channelId, {
    systemPrompt: SYSTEM,
    name: 'Ana',
    message: 'hola',
    budgetChars: 10000,
    ...overrides,
  });
}

test('an empty channel gives just the system prompt and the new user turn', () => {
  const history = new ChannelHistory();
  assert.deepEqual(build(history, 'c1'), [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: 'Ana: hola' },
  ]);
});

test('past user turns carry the speaker prefix; assistant turns do not', () => {
  const history = new ChannelHistory();
  history.append('c1', { name: 'Luis', user: 'pon algo', assistant: '¡Claro!' });

  assert.deepEqual(build(history, 'c1'), [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: 'Luis: pon algo' },
    { role: 'assistant', content: '¡Claro!' },
    { role: 'user', content: 'Ana: hola' },
  ]);
});

test('the oldest pairs are dropped once the history exceeds the budget', () => {
  const history = new ChannelHistory();
  history.append('c1', { name: 'A', user: 'one', assistant: 'x'.repeat(40) });
  history.append('c1', { name: 'B', user: 'two', assistant: 'y'.repeat(40) });
  history.append('c1', { name: 'C', user: 'three', assistant: 'z'.repeat(40) });

  // Each pair is ~45-50 chars; a 100-char budget fits the newest two only.
  const messages = build(history, 'c1', { budgetChars: 100 });
  const contents = messages.map(m => m.content);

  assert.ok(!contents.includes('A: one'), 'oldest pair dropped');
  assert.ok(contents.includes('B: two'));
  assert.ok(contents.includes('C: three'));
});

test('the system prompt is always first and kept even with a zero budget', () => {
  const history = new ChannelHistory();
  history.append('c1', { name: 'A', user: 'one', assistant: 'reply' });

  const messages = build(history, 'c1', { budgetChars: 0 });
  assert.deepEqual(messages, [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: 'Ana: hola' },
  ]);
});

test('channels are isolated from each other', () => {
  const history = new ChannelHistory();
  history.append('c1', { name: 'A', user: 'in c1', assistant: 'r1' });

  assert.equal(build(history, 'c2').length, 2);
  assert.equal(build(history, 'c1').length, 4);
});

test('at most 20 pairs are kept per channel in memory', () => {
  const history = new ChannelHistory();
  for (let i = 0; i < 25; i++) {
    history.append('c1', { name: 'A', user: `m${i}`, assistant: 'ok' });
  }

  assert.equal(MAX_PAIRS, 20);
  const messages = build(history, 'c1');
  assert.equal(messages.length, 1 + 20 * 2 + 1);
  assert.equal(messages[1].content, 'A: m5', 'the five oldest are gone');
});

test('stored assistant text is capped at 600 characters', () => {
  const history = new ChannelHistory();
  history.append('c1', { name: 'A', user: 'q', assistant: 'a'.repeat(1500) });

  const messages = build(history, 'c1');
  assert.equal(messages[2].content.length, STORED_ANSWER_CHARS);
});
