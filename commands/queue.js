// commands/queue.js

const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const MAX_LISTED = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show what is playing and what is queued'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'Music only works in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const queue = interaction.client.music.queueFor(interaction.guildId);

    if (queue.isEmpty) {
      await interaction.reply({ content: 'The queue is empty.', flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = [`▶️ **Now playing:** ${queue.current.title}`];
    const upcoming = queue.upcoming;

    if (upcoming.length > 0) {
      lines.push('', '**Up next:**');
      upcoming.slice(0, MAX_LISTED).forEach((track, index) => {
        lines.push(`${index + 1}. ${track.title}`);
      });

      // Never let the list imply it is complete when it is not.
      if (upcoming.length > MAX_LISTED) {
        lines.push(`…and ${upcoming.length - MAX_LISTED} more.`);
      }
    }

    await interaction.reply(lines.join('\n'));
  },
};
