// chat/mention.js
//
// Pure decisions for @mention chat: does this message ask the bot something,
// and what is the prompt. No Client, no fetches — the message fields are read
// as plain data, so every rule here is unit-tested.
//
// The trigger works on the RAW content, not `message.mentions.has()`: a
// mention inside a quote or code block still appears in `mentions`, but a
// quoted "@bot" is someone talking ABOUT the bot, not to it. Both the trigger
// and the prompt go through the same `stripQuotesAndCode`, so they can never
// disagree about what counts.

const { MessageType } = require('discord.js');
const { cleanInput, cleanName, truncate } = require('./format.js');

const CODE = '[code]';
const PROMPT_MAX_CHARS = 500; // same cap as the /chat option

// Message types a person types; everything else (joins, pins, boosts…) is a system message.
const USER_TYPES = new Set([MessageType.Default, MessageType.Reply]);

/**
 * Discord's rules, in this order:
 *   1. code first (fenced, then inline) → `[code]`, so a `>` in a fence is not a quote;
 *   2. a line-start `>>> ` quotes everything to the end of the message;
 *   3. lines matching `^\s*>\s` are single-line quotes. A bare `>5` is not.
 */
function stripQuotesAndCode(content) {
  return String(content ?? '')
    .replace(/```[\s\S]*?```/g, CODE)
    .replace(/``[^`]+?``|`[^`]+`/g, CODE)
    .replace(/^[ \t]*>>> [\s\S]*$/m, '')
    .split('\n')
    .filter(line => !/^\s*>\s/.test(line))
    .join('\n');
}

function botMentionPatterns({ botId, botRoleId }) {
  const patterns = [`<@${botId}>`, `<@!${botId}>`];
  if (botRoleId) patterns.push(`<@&${botRoleId}>`); // no managed role → role trigger off
  return patterns;
}

/**
 * True when a person, in a guild, mentions the bot user (or its managed role)
 * outside quotes and code.
 * @param {{content?: string, type: number, guildId?: string|null,
 *          author?: {bot?: boolean}, webhookId?: string|null}} message
 * @param {{botId: string, botRoleId?: string|null}} ids
 */
function isMentionTrigger(message, { botId, botRoleId = null }) {
  if (!message?.guildId) return false; // DM
  if (message.author?.bot || message.webhookId) return false;
  if (!USER_TYPES.has(message.type)) return false;

  const text = stripQuotesAndCode(message.content);
  return botMentionPatterns({ botId, botRoleId }).some(pattern => text.includes(pattern));
}

/**
 * The text sent to the model: quotes dropped, code → `[code]`, the bot's own
 * mentions removed, other mentions turned into plain names, whitespace
 * collapsed, at most `maxChars`. '' means there is nothing to answer.
 * @param {string} content
 * @param {{botId: string, botRoleId?: string|null, nameOf: (id: string) => string, maxChars?: number}} options
 */
function extractPrompt(content, { botId, botRoleId = null, nameOf, maxChars = PROMPT_MAX_CHARS }) {
  let text = stripQuotesAndCode(content);
  for (const pattern of botMentionPatterns({ botId, botRoleId })) {
    text = text.split(pattern).join(' ');
  }
  text = text
    .replace(/<@!?(\d+)>/g, (_, id) => `@${cleanName(nameOf(id))}`)
    .replace(/<@&\d+>/g, '@role')
    .replace(/<#\d+>/g, '#channel');
  return truncate(cleanInput(text), maxChars);
}

module.exports = { stripQuotesAndCode, isMentionTrigger, extractPrompt, PROMPT_MAX_CHARS };
