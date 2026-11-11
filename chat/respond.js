// chat/respond.js
//
// Answers an @mention with the local model. index.js calls this only after
// chat/mention.js `isMentionTrigger` said yes; from there it is the same
// pipeline as /chat — the shared gate (cooldown, queue, heat gap), the shared
// per-channel history and chat/run.js — with Discord-message manners instead
// of interaction ones:
//   - refusals are a reaction (🧊 cooldown, ⏳ busy), at most one per user per
//     cooldown window, so a spammer cannot make the bot flood reactions;
//   - missing permissions are silent, with one [Chat] line per channel per hour;
//   - typing is shown while the model works, refreshed every 8 s (Discord
//     drops the indicator after 10 s);
//   - the reply pings nobody — not even the asker — and still goes out as a
//     plain message if the original was deleted meanwhile.
//
// Privacy: never logs message content, and never fetches other messages. A
// DiscordAPIError carries the failed request body (the model's answer), so
// only its code is printed.
//
// Clock and timers are injectable so tests never wait for real time.

const { PermissionFlagsBits } = require('discord.js');
const { cleanName, truncate, EMPTY_REPLY, MAX_REPLY_CHARS } = require('./format.js');
const { extractPrompt } = require('./mention.js');
const { generateReply } = require('./run.js');

const TYPING_REFRESH_MS = 8000;
const PERMISSION_LOG_EVERY_MS = 60 * 60 * 1000;
const REACTIONS = { cooldown: '🧊', busy: '⏳' }; // Unicode — no emoji permission needed
const NO_PINGS = { parse: [], repliedUser: false };

// Per-chat state, keyed by the client.chat object so each test's chat starts clean.
const states = new WeakMap();

/** @returns {{reacted: Map<string, number>, permissionLogged: Map<string, number>}} */
function mentionStateFor(chat) {
  let state = states.get(chat);
  if (!state) {
    state = { reacted: new Map(), permissionLogged: new Map() };
    states.set(chat, state);
  }
  return state;
}

function pruneOlderThan(map, cutoff) {
  for (const [key, ts] of map) {
    if (ts <= cutoff) map.delete(key);
  }
}

/** Names for other mentioned users, from the message's own cache — never fetches. */
function nameOfFrom(message) {
  return id => message.mentions?.members?.get(id)?.displayName
    ?? message.mentions?.users?.get(id)?.username
    ?? 'someone';
}

/**
 * The permissions the bot lacks here. A null `permissionsFor` (no cached
 * `me`, or a thread whose parent is not cached) counts as lacking them all.
 */
function missingPermissions(channel, me) {
  const required = {
    ViewChannel: PermissionFlagsBits.ViewChannel,
    ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
    ...(channel.isThread()
      ? { SendMessagesInThreads: PermissionFlagsBits.SendMessagesInThreads }
      : { SendMessages: PermissionFlagsBits.SendMessages }),
  };
  const permissions = channel.permissionsFor(me);
  const missing = Object.keys(required).filter(name => !permissions?.has(required[name]));
  return { missing, canReact: Boolean(permissions?.has(PermissionFlagsBits.AddReactions)) };
}

/**
 * @param {import('discord.js').Message} message - already passed isMentionTrigger.
 * @param {{chat: object, botId: string, botRoleId?: string|null, now?: () => number,
 *          setInterval?: typeof setInterval, clearInterval?: typeof clearInterval}} options
 */
async function respondToMention(message, {
  chat,
  botId,
  botRoleId = null,
  now = Date.now,
  setInterval: startInterval = setInterval,
  clearInterval: stopInterval = clearInterval,
}) {
  if (!chat?.config.enabled) return;

  const state = mentionStateFor(chat);
  const { channel, channelId } = message;

  const { missing, canReact } = missingPermissions(channel, message.guild?.members.me ?? null);
  if (missing.length > 0) {
    pruneOlderThan(state.permissionLogged, now() - PERMISSION_LOG_EVERY_MS);
    if (!state.permissionLogged.has(channelId)) {
      state.permissionLogged.set(channelId, now());
      console.log(`[Chat] Missing permission ${missing.join(', ')} in ${channelId}`);
    }
    return;
  }

  const prompt = extractPrompt(message.content, { botId, botRoleId, nameOf: nameOfFrom(message) });
  if (!prompt) return;

  // admit() reserves a place synchronously — see chat/gate.js. From here on
  // the reservation must be run or cancelled.
  const admission = chat.gate.admit(message.author.id);
  if (!admission.ok) {
    pruneOlderThan(state.reacted, now() - chat.config.cooldownMs);
    if (canReact && !state.reacted.has(message.author.id)) {
      state.reacted.set(message.author.id, now());
      await message.react(REACTIONS[admission.reason] ?? REACTIONS.busy).catch(() => {});
    }
    return;
  }
  const { ticket } = admission;

  let typing = null;
  const stopTyping = () => {
    if (typing) stopInterval(typing);
    typing = null;
  };
  const sendTyping = () => {
    Promise.resolve().then(() => channel.sendTyping()).catch(() => {});
  };

  let result;
  try {
    sendTyping();
    typing = startInterval(sendTyping, TYPING_REFRESH_MS);
    const name = cleanName(message.member?.displayName ?? message.author.username);
    result = await generateReply({ chat, ticket, channelId, name, message: prompt });
  } catch (error) {
    // A no-op once run() has taken the ticket; frees the place if we threw before it.
    ticket.cancel();
    throw error;
  } finally {
    // Cleared BEFORE the reply, or the indicator lingers on after it.
    stopTyping();
  }

  const content = result.ok ? (result.answer ? truncate(result.answer, MAX_REPLY_CHARS) : EMPTY_REPLY) : result.content;
  try {
    await message.reply({ content, allowedMentions: NO_PINGS, failIfNotExists: false });
  } catch (error) {
    console.error(`[Chat] Could not reply in ${channelId}: ${error.code ?? error.name}`);
  }
}

module.exports = { respondToMention, nameOfFrom, mentionStateFor, TYPING_REFRESH_MS };
