const test = require('node:test');
const assert = require('node:assert/strict');

const { createChat, chatStatusLine } = require('../chat/index.js');
const { ChannelHistory } = require('../chat/history.js');
const { ChatGate } = require('../chat/gate.js');

const quiet = { warn: () => {} };

test('without LLM_BASE_URL chat is disabled and has no provider', () => {
  const chat = createChat({}, quiet);

  assert.equal(chat.config.enabled, false);
  assert.equal(chat.provider, null);
  assert.equal(chatStatusLine(chat.config), '[Chat] Disabled — set LLM_BASE_URL');
});

test('with LLM_BASE_URL every part is assembled from the config', () => {
  const chat = createChat({ LLM_BASE_URL: 'http://llm:8080/v1/', LLM_QUEUE_MAX: '1', LLM_GAP_MS: '0' }, quiet);

  assert.equal(chat.config.enabled, true);
  assert.ok(chat.history instanceof ChannelHistory);
  assert.ok(chat.gate instanceof ChatGate);
  assert.equal(chat.gate.queueMax, 1);
  assert.equal(chat.gate.gapMs, 0);
  assert.equal(typeof chat.provider.complete, 'function');
  assert.equal(chatStatusLine(chat.config), '[Chat] Enabled → http://llm:8080/v1 (model chat)');
});

test('the status line never prints the API key', () => {
  const chat = createChat({ LLM_BASE_URL: 'http://x/v1', LLM_API_KEY: 'sk-secret' }, quiet);
  assert.doesNotMatch(chatStatusLine(chat.config), /sk-secret/);
});
