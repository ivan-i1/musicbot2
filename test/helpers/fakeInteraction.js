// test/helpers/fakeInteraction.js
//
// A minimal stand-in for a ChatInputCommandInteraction, shared by command
// tests. Every response method records `[method, options]` into `calls`, so a
// test can assert what the user saw and whether it was ephemeral.
//
// Deliberately NOT named *.test.js — the runner's glob would pick it up as a
// test file.

/**
 * @param {object} [options]
 * @param {boolean} [options.inGuild=true]
 * @param {Record<string, string|null>} [options.strings] - values for options.getString(name).
 * @param {string} [options.userId]
 * @param {string} [options.username]
 * @param {string|null} [options.displayName] - member display name; null = no member.
 * @param {string} [options.channelId]
 * @param {object} [options.client] - extra client properties, e.g. `{ chat }`.
 * @param {Error} [options.deferError] - make deferReply() reject with this.
 * @param {Error} [options.editError] - make editReply() reject with this.
 */
function fakeInteraction({
  inGuild = true,
  strings = {},
  userId = 'user-1',
  username = 'ana_user',
  displayName = 'Ana',
  channelId = 'channel-1',
  client = {},
  deferError = null,
  editError = null,
} = {}) {
  const calls = [];

  const interaction = {
    calls,
    replied: false,
    deferred: false,
    guildId: inGuild ? 'guild-1' : null,
    channelId,
    user: { id: userId, username, tag: `${username}#0` },
    member: inGuild && displayName !== null ? { displayName } : null,
    client,
    options: {
      getString: name => (name in strings ? strings[name] : null),
    },
    inGuild: () => inGuild,

    async reply(payload) {
      calls.push(['reply', payload]);
      interaction.replied = true;
    },
    async deferReply(payload) {
      calls.push(['deferReply', payload]);
      if (deferError) throw deferError;
      interaction.deferred = true;
    },
    async editReply(payload) {
      calls.push(['editReply', payload]);
      if (editError) throw editError;
    },
    async followUp(payload) {
      calls.push(['followUp', payload]);
    },

    /** Just the method names, in order. */
    methods: () => calls.map(([method]) => method),
  };

  return interaction;
}

module.exports = { fakeInteraction };
