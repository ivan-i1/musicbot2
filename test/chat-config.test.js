const test = require('node:test');
const assert = require('node:assert/strict');

const { parseChatConfig, DEFAULT_SYSTEM_PROMPT } = require('../chat/config.js');

/** Collects warnings instead of printing them. */
function warnSink() {
  const warnings = [];
  return { warnings, warn: msg => warnings.push(msg) };
}

test('defaults match the plan when only the URL is set', () => {
  const config = parseChatConfig({ LLM_BASE_URL: 'http://llm:8080/v1' });

  assert.deepEqual(config, {
    enabled: true,
    baseUrl: 'http://llm:8080/v1',
    model: 'chat',
    apiKey: null,
    maxTokens: 200,
    timeoutMs: 120000,
    queueMax: 3,
    cooldownMs: 20000,
    gapMs: 5000,
    historyChars: 2400,
    temperature: 0.7,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  });
});

test('chat is disabled without LLM_BASE_URL', () => {
  assert.equal(parseChatConfig({}).enabled, false);
  assert.equal(parseChatConfig({ LLM_BASE_URL: '   ' }).enabled, false);
  assert.equal(parseChatConfig({}).baseUrl, null);
});

test('a trailing slash on the URL is stripped', () => {
  assert.equal(parseChatConfig({ LLM_BASE_URL: 'http://llm:8080/v1/' }).baseUrl, 'http://llm:8080/v1');
  assert.equal(parseChatConfig({ LLM_BASE_URL: 'http://llm:8080/v1//' }).baseUrl, 'http://llm:8080/v1');
});

test('valid numeric overrides are honoured', () => {
  const config = parseChatConfig({
    LLM_BASE_URL: 'http://x/v1',
    LLM_MAX_TOKENS: '150',
    LLM_TIMEOUT_MS: '60000',
    LLM_QUEUE_MAX: '0',
    LLM_COOLDOWN_MS: '0',
    LLM_GAP_MS: '1000',
    LLM_HISTORY_CHARS: '800',
    LLM_TEMPERATURE: '0.2',
  });

  assert.equal(config.maxTokens, 150);
  assert.equal(config.timeoutMs, 60000);
  assert.equal(config.queueMax, 0);
  assert.equal(config.cooldownMs, 0);
  assert.equal(config.gapMs, 1000);
  assert.equal(config.historyChars, 800);
  assert.equal(config.temperature, 0.2);
});

test('bad numbers fall back to the default with a warning', () => {
  const sink = warnSink();
  const config = parseChatConfig({
    LLM_BASE_URL: 'http://x/v1',
    LLM_MAX_TOKENS: 'lots',
    LLM_TIMEOUT_MS: '-5',
    LLM_QUEUE_MAX: '2.5',
    LLM_TEMPERATURE: 'hot',
  }, sink);

  assert.equal(config.maxTokens, 200);
  assert.equal(config.timeoutMs, 120000);
  assert.equal(config.queueMax, 3);
  assert.equal(config.temperature, 0.7);
  assert.equal(sink.warnings.length, 4);
  assert.ok(sink.warnings.every(w => w.startsWith('[Chat]')));
  assert.match(sink.warnings[0], /LLM_MAX_TOKENS/);
});

test('an empty numeric value means "use the default", silently', () => {
  const sink = warnSink();
  const config = parseChatConfig({ LLM_BASE_URL: 'http://x/v1', LLM_GAP_MS: '' }, sink);

  assert.equal(config.gapMs, 5000);
  assert.deepEqual(sink.warnings, []);
});

test('model, API key and a custom system prompt are read from env', () => {
  const config = parseChatConfig({
    LLM_BASE_URL: 'http://x/v1',
    LLM_MODEL: 'qwen',
    LLM_API_KEY: 'sk-test',
    LLM_SYSTEM_PROMPT: 'You are a pirate.',
  });

  assert.equal(config.model, 'qwen');
  assert.equal(config.apiKey, 'sk-test');
  assert.equal(config.systemPrompt, 'You are a pirate.');
});

test('the default persona forbids pings and asks for the user\'s language', () => {
  assert.match(DEFAULT_SYSTEM_PROMPT, /language the user writes in/);
  assert.match(DEFAULT_SYSTEM_PROMPT, /Never ping or mention people/);
});
