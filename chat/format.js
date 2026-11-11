// chat/format.js
//
// Input cleaning, output formatting and every user-facing /chat string.
//
// The reply quotes the asker's name and question back into a public bot
// message, so both are escaped: otherwise a user could forge bold "bot" text
// or a masked link that appears to come from the bot. discord.js
// `escapeMarkdown` alone is NOT enough — it leaves `[x](y)` masked links
// intact (checked 2026-11-10) — so `[`, `]`, `<` and `>` are escaped too.
//
// The model's answer is not escaped (it is allowed to use markdown); mentions
// are disabled by the caller with `allowedMentions: { parse: [] }` instead.

const { escapeMarkdown } = require('discord.js');

const MAX_REPLY_CHARS = 2000; // Discord's message limit
const MAX_NAME_CHARS = 32;
const STORED_ANSWER_CHARS = 600; // so one history pair can't swallow the budget
const ELLIPSIS = '…';

const EMPTY_REPLY = "🤔 I've got nothing — ask me something else.";

const MESSAGES = {
  notConfigured: "Chat isn't set up on this bot.",
  guildOnly: 'Chat only works in a server.',
  empty: 'Say something first.',
  cooldown: seconds => `Slow down — try again in ${seconds} s.`,
  busy: "I'm busy, try again in a moment.",
  offline: 'My brain is offline right now — try again later.',
  timeout: 'That took too long — try something shorter.',
};

// C0 + DEL + C1 control characters.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** Collapse all whitespace (newlines included) to single spaces and trim. */
function cleanInput(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** A display name safe to put in a prompt and a quote: printable, short, never empty. */
function cleanName(name) {
  const cleaned = cleanInput(String(name ?? '').replace(CONTROL_CHARS, ' '));
  return cleaned.slice(0, MAX_NAME_CHARS).trim() || 'user';
}

/** Escape user-supplied text so it renders literally inside a bot message. */
function escapeUserText(text) {
  return escapeMarkdown(String(text)).replace(/[[\]<>]/g, '\\$&');
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - ELLIPSIS.length)) + ELLIPSIS;
}

/**
 * `> **<name>:** <question>\n<answer>`, at most 2000 characters. The answer is
 * trimmed first; the quoted header is only cut if it alone would not fit.
 */
function formatReply({ name, question, answer }) {
  const header = truncate(`> **${escapeUserText(name)}:** ${escapeUserText(question)}`, MAX_REPLY_CHARS - 2);
  const body = String(answer ?? '').trim() || EMPTY_REPLY;
  return `${header}\n${truncate(body, MAX_REPLY_CHARS - header.length - 1)}`;
}

/** The assistant text kept in channel history. */
function capStoredAnswer(text) {
  return String(text ?? '').trim().slice(0, STORED_ANSWER_CHARS);
}

module.exports = {
  cleanInput,
  cleanName,
  escapeUserText,
  formatReply,
  capStoredAnswer,
  truncate,
  ELLIPSIS,
  MAX_REPLY_CHARS,
  MAX_NAME_CHARS,
  STORED_ANSWER_CHARS,
  EMPTY_REPLY,
  MESSAGES,
};
