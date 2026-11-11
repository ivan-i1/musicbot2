// test/helpers/fakeMessage.js
//
// A minimal stand-in for a guild Message, for the @mention chat tests. It has
// only the fields chat/mention.js and chat/respond.js read. `react`, `reply`
// and `channel.sendTyping` record into `calls` as `[method, arg]`;
// `permissionsFor` records the member it was asked about.
//
// Deliberately NOT named *.test.js — the runner's glob would pick it up as a
// test file.

const { MessageType, PermissionFlagsBits } = require('discord.js');

const ALL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
];

/**
 * @param {object} [options]
 * @param {string} [options.content]
 * @param {number} [options.type]
 * @param {string} [options.userId]
 * @param {string} [options.username]
 * @param {boolean} [options.bot]
 * @param {string|null} [options.webhookId]
 * @param {string|null} [options.guildId] - null = DM.
 * @param {string|null} [options.displayName] - member display name; null = no member.
 * @param {string} [options.channelId]
 * @param {boolean} [options.thread]
 * @param {bigint[]|null} [options.permissions] - flags the bot has here; null = permissionsFor() returns null.
 * @param {object|null} [options.me] - guild.members.me; null = not cached.
 * @param {Record<string, {displayName?: string, username?: string}>} [options.mentionedMembers]
 * @param {Record<string, {username: string}>} [options.mentionedUsers]
 * @param {Error} [options.reactError] - make react() reject with this.
 * @param {Error} [options.replyError] - make reply() reject with this.
 * @param {Error} [options.typingError] - make sendTyping() reject with this.
 */
function fakeMessage({
  content = '<@1000> hola bot',
  type = MessageType.Default,
  userId = 'user-1',
  username = 'ana_user',
  bot = false,
  webhookId = null,
  guildId = 'guild-1',
  displayName = 'Ana',
  channelId = 'channel-1',
  thread = false,
  permissions = ALL_PERMISSIONS,
  me = { id: '1000' },
  mentionedMembers = {},
  mentionedUsers = {},
  reactError = null,
  replyError = null,
  typingError = null,
} = {}) {
  const calls = [];

  const channel = {
    id: channelId,
    isThread: () => thread,
    permissionsFor(member) {
      calls.push(['permissionsFor', member]);
      if (permissions === null || !member) return null;
      return { has: flag => permissions.includes(flag) };
    },
    async sendTyping() {
      calls.push(['sendTyping']);
      if (typingError) throw typingError;
    },
  };

  const message = {
    calls,
    content,
    type,
    author: { id: userId, bot, username },
    webhookId,
    guildId,
    guild: guildId ? { members: { me } } : null,
    member: guildId && displayName !== null ? { displayName } : null,
    channelId,
    channel,
    mentions: {
      members: new Map(Object.entries(mentionedMembers)),
      users: new Map(Object.entries(mentionedUsers)),
    },

    async react(emoji) {
      calls.push(['react', emoji]);
      if (reactError) throw reactError;
    },
    async reply(options) {
      calls.push(['reply', options]);
      if (replyError) throw replyError;
    },

    /** Just the method names, in order. */
    methods: () => calls.map(([method]) => method),
    /** The calls of one method. */
    callsOf: method => calls.filter(([m]) => m === method).map(([, arg]) => arg),
  };

  return message;
}

module.exports = { fakeMessage, ALL_PERMISSIONS };
