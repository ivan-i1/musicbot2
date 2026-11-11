const test = require('node:test');
const assert = require('node:assert/strict');

const { generateReply } = require('../chat/run.js');
const { parseChatConfig } = require('../chat/config.js');
const { ChannelHistory } = require('../chat/history.js');
const { ChatGate } = require('../chat/gate.js');
const { ChatTimeoutError, ChatUnavailableError } = require('../chat/provider.js');
const { MESSAGES } = require('../chat/format.js');

/** Swap console.log/error for recorders for the duration of `fn`; returns [result, lines]. */
async function captureLogs(fn) {
  const lines = [];
  const { log, error } = console;
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  try {
    return [await fn(), lines];
  } finally {
    console.log = log;
    console.error = error;
  }
}

function stubProvider({ text = '¡Hola!', error = null, delayMs = 0 } = {}) {
  const requests = [];
  return {
    requests,
    async complete(request) {
      requests.push({ ...request, abortedAtStart: request.signal?.aborted ?? null });
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      if (error) throw error;
      return { text, finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 3 } };
    },
  };
}

function makeChat({ env = {}, provider = stubProvider() } = {}) {
  const config = parseChatConfig({ LLM_BASE_URL: 'http://llm:8080/v1', LLM_GAP_MS: '0', ...env }, { warn: () => {} });
  return {
    config,
    history: new ChannelHistory(),
    gate: new ChatGate({ queueMax: config.queueMax, cooldownMs: config.cooldownMs, gapMs: config.gapMs }),
    provider,
  };
}

function run(chat, { userId = 'u1', channelId = 'channel-1', name = 'Ana', message = 'hola bot' } = {}) {
  const admission = chat.gate.admit(userId);
  assert.equal(admission.ok, true, 'test setup: admitted');
  return generateReply({ chat, ticket: admission.ticket, channelId, name, message });
}

const pastPairs = chat =>
  chat.history.build('channel-1', { systemPrompt: 's', name: 'X', message: 'y', budgetChars: 9999 }).length - 2;

test('success returns the trimmed answer and appends the exchange to the channel history', async () => {
  const chat = makeChat({ provider: stubProvider({ text: '  ¡Hola!  ' }) });
  const [result] = await captureLogs(() => run(chat));

  assert.deepEqual(result, { ok: true, answer: '¡Hola!' });
  const messages = chat.history.build('channel-1', { systemPrompt: 's', name: 'X', message: 'y', budgetChars: 9999 });
  assert.deepEqual(messages.slice(1, 3), [
    { role: 'user', content: 'Ana: hola bot' },
    { role: 'assistant', content: '¡Hola!' },
  ]);
});

test('the provider gets system + history + the prefixed turn and the configured limits', async () => {
  const provider = stubProvider();
  const chat = makeChat({ provider, env: { LLM_MAX_TOKENS: '150', LLM_TEMPERATURE: '0.3' } });
  chat.history.append('channel-1', { name: 'Luis', user: 'antes', assistant: 'vale' });

  await captureLogs(() => run(chat));

  const [request] = provider.requests;
  assert.equal(request.maxTokens, 150);
  assert.equal(request.temperature, 0.3);
  assert.ok(request.signal instanceof AbortSignal);
  assert.deepEqual(request.messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(request.messages.at(-1).content, 'Ana: hola bot');
});

test('an empty answer is ok with answer "" and is NOT appended', async () => {
  const chat = makeChat({ provider: stubProvider({ text: '   ' }) });
  const [result] = await captureLogs(() => run(chat));
  assert.deepEqual(result, { ok: true, answer: '' });
  assert.equal(pastPairs(chat), 0);
});

for (const [label, error, content] of [
  ['unavailable', new ChatUnavailableError('HTTP 503'), MESSAGES.offline],
  ['timeout', new ChatTimeoutError(), MESSAGES.timeout],
]) {
  test(`${label}: friendly content, a [Chat] log line, nothing appended`, async () => {
    const chat = makeChat({ provider: stubProvider({ error }) });
    const [result, lines] = await captureLogs(() => run(chat));

    assert.deepEqual(result, { ok: false, content });
    assert.ok(lines.some(l => l.startsWith('[Chat]') && l.includes(error.name)), lines.join('\n'));
    assert.equal(pastPairs(chat), 0);
  });
}

test('an unknown error is rethrown and the gate place is released', async () => {
  const chat = makeChat({ env: { LLM_QUEUE_MAX: '0' }, provider: stubProvider({ error: new RangeError('bug') }) });
  await assert.rejects(run(chat), RangeError);
  assert.equal(chat.gate.admit('someone-else').ok, true);
});

test('the signal is created when the job starts, so queue time does not eat the timeout', async () => {
  const provider = stubProvider({ delayMs: 300 });
  const chat = makeChat({ provider, env: { LLM_TIMEOUT_MS: '150', LLM_COOLDOWN_MS: '0' } });

  await captureLogs(() => Promise.all([run(chat, { userId: 'a' }), run(chat, { userId: 'b' })]));

  assert.equal(provider.requests.length, 2);
  assert.equal(provider.requests[1].abortedAtStart, false);
});

test('the log line carries no message, history or model output', async () => {
  const chat = makeChat({ provider: stubProvider({ text: 'MODEL-OUTPUT-XYZ' }) });
  chat.history.append('channel-1', { name: 'Luis', user: 'HISTORY-ABC', assistant: 'HISTORY-DEF' });

  const [, lines] = await captureLogs(() => run(chat, { message: 'USER-SECRET-123' }));

  assert.ok(lines.some(l => l.startsWith('[Chat] Reply in channel-1')), lines.join('\n'));
  for (const needle of ['USER-SECRET-123', 'MODEL-OUTPUT-XYZ', 'HISTORY-ABC', 'HISTORY-DEF']) {
    assert.ok(!lines.some(l => l.includes(needle)), `${needle} leaked into logs`);
  }
});
