const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');

const command = require('../commands/chat.js');
const { fakeInteraction } = require('./helpers/fakeInteraction.js');
const { parseChatConfig } = require('../chat/config.js');
const { ChannelHistory } = require('../chat/history.js');
const { ChatGate } = require('../chat/gate.js');
const { ChatTimeoutError, ChatUnavailableError } = require('../chat/provider.js');
const { MESSAGES, EMPTY_REPLY } = require('../chat/format.js');

/** Swap console.log/error for recorders for the duration of `fn`. */
async function captureLogs(fn) {
  const lines = [];
  const { log, error } = console;
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
  return lines;
}

/** A stub provider: answers with `text`, or throws `error`; records each request. */
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

/** A real client.chat (real config, history and gate) around a stub provider. */
function makeChat({ env = {}, provider = stubProvider(), gate } = {}) {
  const config = parseChatConfig({ LLM_BASE_URL: 'http://llm:8080/v1', LLM_GAP_MS: '0', ...env }, { warn: () => {} });
  return {
    config,
    history: new ChannelHistory(),
    gate: gate ?? new ChatGate({ queueMax: config.queueMax, cooldownMs: config.cooldownMs, gapMs: config.gapMs }),
    provider,
  };
}

function chatInteraction({ chat = makeChat(), message = 'hola bot', ...rest } = {}) {
  return fakeInteraction({ strings: { message }, client: { chat }, ...rest });
}

function assertEphemeral(interaction, content) {
  assert.deepEqual(interaction.methods(), ['reply'], 'replied once, never deferred');
  const [, payload] = interaction.calls[0];
  assert.equal(payload.content, content);
  assert.equal(payload.flags, MessageFlags.Ephemeral);
  assert.ok(!('ephemeral' in payload), '`ephemeral` is deprecated in discord.js v14');
}

const lastEdit = interaction => interaction.calls.filter(([m]) => m === 'editReply').at(-1)[1];

// --- definition ---------------------------------------------------------------

test('defines /chat with a required message option capped at 500 characters', () => {
  const json = command.data.toJSON();
  assert.equal(json.name, 'chat');
  const option = json.options.find(o => o.name === 'message');
  assert.equal(option.required, true);
  assert.equal(option.max_length, 500);
  assert.equal(typeof command.execute, 'function');
});

// --- refusals: ephemeral, no defer --------------------------------------------

test('a DM is refused ephemerally', async () => {
  const interaction = chatInteraction({ inGuild: false });
  await command.execute(interaction);
  assertEphemeral(interaction, MESSAGES.guildOnly);
});

test('without LLM_BASE_URL the command says chat is not set up', async () => {
  const chat = { config: parseChatConfig({}, { warn: () => {} }) };
  const interaction = chatInteraction({ chat });
  await command.execute(interaction);
  assertEphemeral(interaction, MESSAGES.notConfigured);
});

test('a missing client.chat is treated as not set up, not a crash', async () => {
  const interaction = fakeInteraction({ strings: { message: 'hi' }, client: {} });
  await command.execute(interaction);
  assertEphemeral(interaction, MESSAGES.notConfigured);
});

test('whitespace-only input is refused without touching the gate', async () => {
  const chat = makeChat({ gate: { admit: () => assert.fail('gate must not be consulted') } });
  const interaction = chatInteraction({ chat, message: ' \n\t ' });
  await command.execute(interaction);
  assertEphemeral(interaction, MESSAGES.empty);
});

test('a cooldown refusal is ephemeral, gives the wait, and does not defer', async () => {
  const chat = makeChat({ gate: { admit: () => ({ ok: false, reason: 'cooldown', retryInS: 12 }) } });
  const interaction = chatInteraction({ chat });
  await command.execute(interaction);
  assertEphemeral(interaction, MESSAGES.cooldown(12));
});

test('a busy refusal is ephemeral and does not defer', async () => {
  const chat = makeChat({ gate: { admit: () => ({ ok: false, reason: 'busy' }) } });
  const interaction = chatInteraction({ chat });
  await command.execute(interaction);
  assertEphemeral(interaction, MESSAGES.busy);
});

// --- happy path ---------------------------------------------------------------

test('success defers publicly, then edits in the quoted reply with mentions disabled', async () => {
  const provider = stubProvider({ text: '@everyone ¡Hola!' });
  const chat = makeChat({ provider });
  const interaction = chatInteraction({ chat, message: 'hola\nbot' });

  await captureLogs(() => command.execute(interaction));

  assert.deepEqual(interaction.methods(), ['deferReply', 'editReply']);
  assert.ok(!interaction.calls[0][1]?.flags, 'the deferred reply is public');
  assert.deepEqual(lastEdit(interaction), {
    content: '> **Ana:** hola bot\n@everyone ¡Hola!',
    allowedMentions: { parse: [] },
  });
});

test('the provider gets system + history + the new prefixed turn, with the configured limits', async () => {
  const provider = stubProvider();
  const chat = makeChat({ provider, env: { LLM_MAX_TOKENS: '150', LLM_TEMPERATURE: '0.3' } });
  chat.history.append('channel-1', { name: 'Luis', user: 'antes', assistant: 'vale' });

  await captureLogs(() => command.execute(chatInteraction({ chat })));

  const [request] = provider.requests;
  assert.equal(request.maxTokens, 150);
  assert.equal(request.temperature, 0.3);
  assert.ok(request.signal instanceof AbortSignal);
  assert.deepEqual(request.messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(request.messages.at(-1).content, 'Ana: hola bot');
});

test('the speaker name falls back to the username when there is no member', async () => {
  const provider = stubProvider();
  await captureLogs(() => command.execute(chatInteraction({ chat: makeChat({ provider }), displayName: null })));
  assert.equal(provider.requests[0].messages.at(-1).content, 'ana_user: hola bot');
});

test('a successful exchange is appended to that channel\'s history', async () => {
  const chat = makeChat({ provider: stubProvider({ text: '  ¡Hola!  ' }) });
  await captureLogs(() => command.execute(chatInteraction({ chat })));

  const messages = chat.history.build('channel-1', { systemPrompt: 's', name: 'X', message: 'y', budgetChars: 9999 });
  assert.deepEqual(messages.slice(1, 3), [
    { role: 'user', content: 'Ana: hola bot' },
    { role: 'assistant', content: '¡Hola!' },
  ]);
});

test('an empty model answer shows EMPTY_REPLY and is NOT added to history', async () => {
  const chat = makeChat({ provider: stubProvider({ text: '   ' }) });
  const interaction = chatInteraction({ chat });
  await captureLogs(() => command.execute(interaction));

  assert.equal(lastEdit(interaction).content, `> **Ana:** hola bot\n${EMPTY_REPLY}`);
  assert.equal(chat.history.build('channel-1', { systemPrompt: 's', name: 'X', message: 'y', budgetChars: 9999 }).length, 2);
});

// --- known failures -----------------------------------------------------------

for (const [label, error, content] of [
  ['unavailable', new ChatUnavailableError('HTTP 503'), MESSAGES.offline],
  ['timeout', new ChatTimeoutError(), MESSAGES.timeout],
]) {
  test(`${label}: friendly edit, mentions disabled, [Chat] log, nothing added to history`, async () => {
    const chat = makeChat({ provider: stubProvider({ error }) });
    const interaction = chatInteraction({ chat });

    const lines = await captureLogs(() => command.execute(interaction));

    assert.deepEqual(lastEdit(interaction), { content, allowedMentions: { parse: [] } });
    assert.ok(lines.some(l => l.startsWith('[Chat]') && l.includes(error.name)), lines.join('\n'));
    assert.equal(chat.history.build('channel-1', { systemPrompt: 's', name: 'X', message: 'y', budgetChars: 9999 }).length, 2);
  });
}

test('an unexpected error is rethrown for the index.js handler, and the place is released', async () => {
  const chat = makeChat({ env: { LLM_QUEUE_MAX: '0', LLM_COOLDOWN_MS: '0' }, provider: stubProvider({ error: new RangeError('bug') }) });
  await assert.rejects(command.execute(chatInteraction({ chat })), RangeError);
  assert.equal(chat.gate.admit('someone-else').ok, true);
});

// --- transport failures -------------------------------------------------------

test('if editReply throws (expired token) it is logged and swallowed', async () => {
  const editError = Object.assign(new Error('Unknown Webhook'), { code: 10015, requestBody: { json: { content: 'SECRET' } } });
  const interaction = chatInteraction({ editError });

  let lines;
  await assert.doesNotReject(async () => { lines = await captureLogs(() => command.execute(interaction)); });
  assert.ok(lines.some(l => l.startsWith('[Chat]') && l.includes('10015')));
  assert.ok(!lines.some(l => l.includes('SECRET')), 'the failed payload (model output) is never logged');
});

test('if deferReply throws, the reservation is cancelled and the error rethrown', async () => {
  const chat = makeChat({ env: { LLM_QUEUE_MAX: '0' } });
  const interaction = chatInteraction({ chat, deferError: new Error('Unknown interaction') });

  await assert.rejects(command.execute(interaction), /Unknown interaction/);
  assert.equal(chat.provider.requests.length, 0, 'never called the model');
  assert.equal(chat.gate.admit('someone-else').ok, true, 'place released');
});

// --- privacy ------------------------------------------------------------------

test('logs never contain the user message, the history or the model output', async () => {
  const chat = makeChat({ provider: stubProvider({ text: 'MODEL-OUTPUT-XYZ' }) });
  chat.history.append('channel-1', { name: 'Luis', user: 'HISTORY-ABC', assistant: 'HISTORY-DEF' });

  const lines = await captureLogs(() => command.execute(chatInteraction({ chat, message: 'USER-SECRET-123' })));

  assert.ok(lines.length > 0, 'an event line is still written');
  for (const needle of ['USER-SECRET-123', 'MODEL-OUTPUT-XYZ', 'HISTORY-ABC', 'HISTORY-DEF']) {
    assert.ok(!lines.some(l => l.includes(needle)), `${needle} leaked into logs`);
  }
});

// --- timeout placement --------------------------------------------------------

test('a queued job gets its full timeout: the signal is created when the job starts, not when queued', async () => {
  // 150 ms timeout; the first job takes 300 ms. Had the second job's signal
  // been created at admit time, it would already be aborted when it starts.
  const provider = stubProvider({ delayMs: 300 });
  const chat = makeChat({ provider, env: { LLM_TIMEOUT_MS: '150', LLM_COOLDOWN_MS: '0' } });

  await captureLogs(() => Promise.all([
    command.execute(chatInteraction({ chat, userId: 'a' })),
    command.execute(chatInteraction({ chat, userId: 'b' })),
  ]));

  assert.equal(provider.requests.length, 2);
  assert.equal(provider.requests[1].abortedAtStart, false);
});
