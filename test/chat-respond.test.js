const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');

const { respondToMention, nameOfFrom, mentionStateFor, TYPING_REFRESH_MS } = require('../chat/respond.js');
const { fakeMessage, ALL_PERMISSIONS } = require('./helpers/fakeMessage.js');
const { fakeInteraction } = require('./helpers/fakeInteraction.js');
const chatCommand = require('../commands/chat.js');
const { parseChatConfig } = require('../chat/config.js');
const { ChannelHistory } = require('../chat/history.js');
const { ChatGate } = require('../chat/gate.js');
const { ChatUnavailableError } = require('../chat/provider.js');
const { MESSAGES, EMPTY_REPLY } = require('../chat/format.js');

const BOT = '1000';
const ROLE = '2000';

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

function stubProvider({ text = '¡Hola!', error = null, until = null } = {}) {
  const requests = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      if (until) await until;
      if (error) throw error;
      return { text, finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 3 } };
    },
  };
}

function makeChat({ env = {}, provider = stubProvider(), gate } = {}) {
  const config = parseChatConfig({ LLM_BASE_URL: 'http://llm:8080/v1', LLM_GAP_MS: '0', ...env }, { warn: () => {} });
  return {
    config,
    history: new ChannelHistory(),
    gate: gate ?? new ChatGate({ queueMax: config.queueMax, cooldownMs: config.cooldownMs, gapMs: config.gapMs }),
    provider,
  };
}

/** Injected timers that record what happened, without real waiting. */
function fakeTimers(events = []) {
  return {
    events,
    setInterval: (fn, ms) => { events.push(['setInterval', ms]); return { fn }; },
    clearInterval: handle => { if (handle) events.push(['clearInterval']); },
  };
}

function respond(message, { chat = makeChat(), now, timers = fakeTimers() } = {}) {
  return respondToMention(message, {
    chat, botId: BOT, botRoleId: ROLE, now,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
  });
}

const without = flag => ALL_PERMISSIONS.filter(f => f !== flag);
const refusingGate = refusal => ({ admit: () => refusal });
const COOLDOWN = { ok: false, reason: 'cooldown', retryInS: 12 };
const BUSY = { ok: false, reason: 'busy' };

// --- disabled / permissions / empty -------------------------------------------

test('chat disabled: nothing is touched', async () => {
  const message = fakeMessage();
  await respond(message, { chat: { config: parseChatConfig({}, { warn: () => {} }) } });
  await respondToMention(message, { chat: undefined, botId: BOT, botRoleId: ROLE });
  assert.deepEqual(message.calls, []);
});

test('missing SendMessages: no reply, no typing, one [Chat] log line', async () => {
  const chat = makeChat({ gate: { admit: () => assert.fail('gate must not be consulted') } });
  const message = fakeMessage({ permissions: without(PermissionFlagsBits.SendMessages) });

  const lines = await captureLogs(() => respond(message, { chat }));

  assert.deepEqual(message.methods(), ['permissionsFor']);
  assert.deepEqual(lines, ['[Chat] Missing permission SendMessages in channel-1']);
});

test('in a thread SendMessagesInThreads is required instead of SendMessages', async () => {
  const noThreadSend = fakeMessage({ thread: true, permissions: without(PermissionFlagsBits.SendMessagesInThreads) });
  const lines = await captureLogs(() => respond(noThreadSend));
  assert.deepEqual(lines, ['[Chat] Missing permission SendMessagesInThreads in channel-1']);

  const threadOk = fakeMessage({ thread: true, permissions: without(PermissionFlagsBits.SendMessages) });
  await captureLogs(() => respond(threadOk));
  assert.equal(threadOk.callsOf('reply').length, 1);
});

test('missing ReadMessageHistory or ViewChannel is also silent', async () => {
  for (const flag of [PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ViewChannel]) {
    const message = fakeMessage({ permissions: without(flag) });
    const lines = await captureLogs(() => respond(message));
    assert.deepEqual(message.methods(), ['permissionsFor']);
    assert.equal(lines.length, 1);
  }
});

test('permissionsFor returning null (no cached me, parentless thread) counts as missing', async () => {
  for (const options of [{ permissions: null }, { me: null }]) {
    const message = fakeMessage(options);
    const lines = await captureLogs(() => respond(message));
    assert.deepEqual(message.methods(), ['permissionsFor']);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[Chat\] Missing permission .+ in channel-1$/);
  }
});

test('the missing-permission log is rate-limited per channel for an hour', async () => {
  const chat = makeChat();
  let t = 1_000_000;
  const now = () => t;
  const perms = without(PermissionFlagsBits.SendMessages);

  const lines = await captureLogs(async () => {
    await respond(fakeMessage({ permissions: perms }), { chat, now });
    await respond(fakeMessage({ permissions: perms }), { chat, now });
    await respond(fakeMessage({ permissions: perms, channelId: 'channel-2' }), { chat, now });
    t += 60 * 60 * 1000 + 1;
    await respond(fakeMessage({ permissions: perms }), { chat, now });
  });

  assert.deepEqual(lines, [
    '[Chat] Missing permission SendMessages in channel-1',
    '[Chat] Missing permission SendMessages in channel-2',
    '[Chat] Missing permission SendMessages in channel-1',
  ]);
});

test('a prompt that is empty after cleaning is ignored silently', async () => {
  const chat = makeChat({ gate: { admit: () => assert.fail('gate must not be consulted') } });
  const message = fakeMessage({ content: `<@${BOT}>\n> just a quote` });
  const lines = await captureLogs(() => respond(message, { chat }));
  assert.deepEqual(message.methods(), ['permissionsFor']);
  assert.deepEqual(lines, []);
});

// --- refusals: reactions ------------------------------------------------------

test('cooldown: 🧊 once, and no second 🧊 within the window', async () => {
  const chat = makeChat({ gate: refusingGate(COOLDOWN) });
  let t = 1_000_000;
  const now = () => t;

  const first = fakeMessage();
  await respond(first, { chat, now });
  assert.deepEqual(first.callsOf('react'), ['🧊']);
  assert.equal(first.callsOf('reply').length, 0);
  assert.equal(first.callsOf('sendTyping').length, 0);

  t += chat.config.cooldownMs - 1;
  const second = fakeMessage();
  await respond(second, { chat, now });
  assert.deepEqual(second.callsOf('react'), []);

  t += 2;
  const third = fakeMessage();
  await respond(third, { chat, now });
  assert.deepEqual(third.callsOf('react'), ['🧊'], 'a new window allows one more');
});

test('busy: ⏳, deduped per user', async () => {
  const chat = makeChat({ gate: refusingGate(BUSY) });
  const now = () => 5;

  const a1 = fakeMessage({ userId: 'a' });
  const a2 = fakeMessage({ userId: 'a' });
  const b1 = fakeMessage({ userId: 'b' });
  await respond(a1, { chat, now });
  await respond(a2, { chat, now });
  await respond(b1, { chat, now });

  assert.deepEqual(a1.callsOf('react'), ['⏳']);
  assert.deepEqual(a2.callsOf('react'), []);
  assert.deepEqual(b1.callsOf('react'), ['⏳'], 'other users are not affected');
});

test('the reaction dedupe map is pruned of entries older than the cooldown', async () => {
  const chat = makeChat({ gate: refusingGate(BUSY) });
  let t = 1_000_000;
  const now = () => t;

  await respond(fakeMessage({ userId: 'a' }), { chat, now });
  await respond(fakeMessage({ userId: 'b' }), { chat, now });
  assert.deepEqual([...mentionStateFor(chat).reacted.keys()].sort(), ['a', 'b']);

  t += chat.config.cooldownMs + 1;
  await respond(fakeMessage({ userId: 'c' }), { chat, now });
  assert.deepEqual([...mentionStateFor(chat).reacted.keys()], ['c']);
});

test('without AddReactions, refusals are silent (no react call)', async () => {
  const chat = makeChat({ gate: refusingGate(COOLDOWN) });
  const message = fakeMessage({ permissions: without(PermissionFlagsBits.AddReactions) });
  await respond(message, { chat });
  assert.deepEqual(message.methods(), ['permissionsFor']);
});

test('a failing react() is swallowed', async () => {
  const chat = makeChat({ gate: refusingGate(BUSY) });
  const message = fakeMessage({ reactError: new Error('Missing Access') });
  await assert.doesNotReject(respond(message, { chat }));
});

// --- shared gate with /chat ---------------------------------------------------

test('a mention admit puts the user on cooldown for /chat too', async () => {
  const chat = makeChat();
  await captureLogs(() => respond(fakeMessage({ userId: 'u1' }), { chat }));

  const interaction = fakeInteraction({ userId: 'u1', strings: { message: 'otra' }, client: { chat } });
  await chatCommand.execute(interaction);

  assert.deepEqual(interaction.methods(), ['reply']);
  assert.match(interaction.calls[0][1].content, /^Slow down/);
  assert.equal(interaction.calls[0][1].flags, MessageFlags.Ephemeral);
});

test('a /chat admit puts the user on cooldown for mentions (🧊)', async () => {
  const chat = makeChat();
  await captureLogs(() => chatCommand.execute(
    fakeInteraction({ userId: 'u1', strings: { message: 'hola' }, client: { chat } })));

  const message = fakeMessage({ userId: 'u1' });
  await respond(message, { chat });
  assert.deepEqual(message.callsOf('react'), ['🧊']);
  assert.equal(message.callsOf('reply').length, 0);
});

test('mentions and /chat share one channel history', async () => {
  const chat = makeChat({ env: { LLM_COOLDOWN_MS: '0' } });
  await captureLogs(() => respond(fakeMessage({ content: `<@${BOT}> primero` }), { chat }));
  await captureLogs(() => chatCommand.execute(
    fakeInteraction({ strings: { message: 'segundo' }, client: { chat } })));

  const contents = chat.provider.requests[1].messages.map(m => m.content);
  assert.deepEqual(contents.slice(1), ['Ana: primero', '¡Hola!', 'Ana: segundo']);
});

// --- admitted path ------------------------------------------------------------

test('a throw between admit and run cancels the ticket and frees the place', async () => {
  const chat = makeChat({ env: { LLM_QUEUE_MAX: '0' } });
  const timers = { setInterval: () => { throw new Error('timer boom'); }, clearInterval: () => {} };

  await assert.rejects(respond(fakeMessage(), { chat, timers }), /timer boom/);
  assert.equal(chat.provider.requests.length, 0, 'never called the model');
  assert.equal(chat.gate.admit('someone-else').ok, true, 'place released');
});

test('typing is sent at 0 s and again at 8 s, then stops (mock.timers)', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let release;
  const until = new Promise(r => { release = r; });
  const chat = makeChat({ provider: stubProvider({ until }) });
  const message = fakeMessage();
  const flush = () => new Promise(r => setImmediate(r));

  let done;
  const lines = captureLogs(async () => {
    done = respondToMention(message, { chat, botId: BOT, botRoleId: ROLE });
    await flush();
    assert.equal(message.callsOf('sendTyping').length, 1, 'typing at 0 s');

    t.mock.timers.tick(TYPING_REFRESH_MS - 1);
    await flush();
    assert.equal(message.callsOf('sendTyping').length, 1);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(message.callsOf('sendTyping').length, 2, 'typing again at 8 s');

    release();
    await done;
  });
  await lines;

  assert.equal(TYPING_REFRESH_MS, 8000);
  t.mock.timers.tick(TYPING_REFRESH_MS * 3);
  await new Promise(r => setImmediate(r));
  assert.equal(message.callsOf('sendTyping').length, 2, 'cleared after the reply');
  assert.deepEqual(message.methods().slice(-1), ['reply']);
});

test('the typing interval is cleared BEFORE the reply is sent', async () => {
  const events = [];
  const timers = fakeTimers(events);
  const message = fakeMessage();
  const reply = message.reply;
  message.reply = async options => { events.push(['reply']); return reply(options); };

  await captureLogs(() => respond(message, { timers }));

  const names = events.map(([e]) => e);
  assert.deepEqual(names.slice(0, 1), ['setInterval']);
  assert.ok(names.indexOf('clearInterval') < names.indexOf('reply'), names.join(','));
  assert.equal(events[0][1], TYPING_REFRESH_MS);
});

test('a failing sendTyping is swallowed and the reply still goes out', async () => {
  const message = fakeMessage({ typingError: new Error('Missing Access') });
  await captureLogs(() => respond(message));
  assert.equal(message.callsOf('reply').length, 1);
});

test('success: a reply that pings no one and survives a deleted original', async () => {
  const chat = makeChat({ provider: stubProvider({ text: '  @everyone ¡Hola!  ' }) });
  const message = fakeMessage({ content: `<@${BOT}> hola <@3000>`, mentionedMembers: { 3000: { displayName: 'Luis' } } });

  await captureLogs(() => respond(message, { chat }));

  assert.deepEqual(message.callsOf('reply'), [{
    content: '@everyone ¡Hola!',
    allowedMentions: { parse: [], repliedUser: false },
    failIfNotExists: false,
  }]);
  assert.equal(chat.provider.requests[0].messages.at(-1).content, 'Ana: hola @Luis');
  assert.deepEqual(message.callsOf('react'), []);
});

test('the speaker falls back to the username, and a long answer is cut to 2000', async () => {
  const chat = makeChat({ provider: stubProvider({ text: 'x'.repeat(2500) }) });
  const message = fakeMessage({ displayName: null });
  await captureLogs(() => respond(message, { chat }));

  assert.equal(chat.provider.requests[0].messages.at(-1).content, 'ana_user: hola bot');
  const [{ content }] = message.callsOf('reply');
  assert.equal(content.length, 2000);
  assert.ok(content.endsWith('…'));
});

test('an empty answer replies EMPTY_REPLY', async () => {
  const message = fakeMessage();
  await captureLogs(() => respond(message, { chat: makeChat({ provider: stubProvider({ text: ' ' }) }) }));
  assert.equal(message.callsOf('reply')[0].content, EMPTY_REPLY);
});

test('offline: the friendly text is replied, with no pings', async () => {
  const chat = makeChat({ provider: stubProvider({ error: new ChatUnavailableError('HTTP 503') }) });
  const message = fakeMessage();
  await captureLogs(() => respond(message, { chat }));
  assert.deepEqual(message.callsOf('reply'), [{
    content: MESSAGES.offline,
    allowedMentions: { parse: [], repliedUser: false },
    failIfNotExists: false,
  }]);
});

test('a reply that throws is logged by code only, never with the payload', async () => {
  const replyError = Object.assign(new Error('Missing Permissions'), { code: 50013, requestBody: { json: { content: 'SECRET' } } });
  const chat = makeChat({ provider: stubProvider({ text: 'MODEL-OUTPUT-XYZ' }) });
  const message = fakeMessage({ content: `<@${BOT}> USER-SECRET-123`, replyError });

  let lines;
  await assert.doesNotReject(async () => { lines = await captureLogs(() => respond(message, { chat })); });

  assert.ok(lines.includes('[Chat] Could not reply in channel-1: 50013'), lines.join('\n'));
  for (const needle of ['SECRET', 'MODEL-OUTPUT-XYZ', 'USER-SECRET-123']) {
    assert.ok(!lines.some(l => l.includes(needle)), `${needle} leaked into logs`);
  }
});

// --- nameOf -------------------------------------------------------------------

test('nameOfFrom reads cached mentions only: member name, then username, then "someone"', () => {
  const message = fakeMessage({
    mentionedMembers: { 1: { displayName: 'Luis' } },
    mentionedUsers: { 1: { username: 'luis_u' }, 2: { username: 'eva_u' } },
  });
  const nameOf = nameOfFrom(message);
  assert.equal(nameOf('1'), 'Luis');
  assert.equal(nameOf('2'), 'eva_u');
  assert.equal(nameOf('3'), 'someone');
  assert.equal(nameOfFrom({ mentions: { members: null, users: new Map() } })('1'), 'someone');
});
