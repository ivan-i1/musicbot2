// tracking.js
//
// Decisions for the passive messageCreate logger, kept as pure functions so
// they can be unit-tested without a gateway connection.

/**
 * Parses the TRACKED_CHANNEL_IDS env var into a list of channel IDs.
 * Tolerates whitespace and empty segments, so "111, 222," is fine.
 *
 * @param {string|undefined} raw
 * @returns {string[]}
 */
function parseTrackedChannels(raw) {
  if (!raw) return [];
  return raw.split(',').map(id => id.trim()).filter(Boolean);
}

/**
 * Whether a message should be logged by the tracker.
 *
 * Deliberately OPT-IN: with no channels configured this returns false for
 * everything. The previous behaviour logged the author, channel and full word
 * count of every message in every channel the bot could see, which is a
 * privacy problem and was flagged as such in the original code's own comment.
 *
 * @param {import('discord.js').Message} message
 * @param {string[]} allowedChannelIds
 * @returns {boolean}
 */
function shouldTrack(message, allowedChannelIds) {
  // Never react to bots — including ourselves. This is what stops feedback loops.
  if (message.author?.bot) return false;

  if (!allowedChannelIds || allowedChannelIds.length === 0) return false;

  return allowedChannelIds.includes(message.channel?.id);
}

/**
 * Derives the tracked statistics from raw message content.
 *
 * @param {string} content
 * @returns {{charCount: number, wordCount: number, lookingForGroup: boolean}}
 */
function messageStats(content) {
  const text = content ?? '';
  return {
    charCount: text.length,
    // filter(Boolean) drops the empty strings that a leading/trailing or
    // repeated separator produces, so "" is 0 words rather than 1.
    wordCount: text.split(/\s+/).filter(Boolean).length,
    lookingForGroup: text.toLowerCase().includes('lfg'),
  };
}

module.exports = { parseTrackedChannels, shouldTrack, messageStats };
