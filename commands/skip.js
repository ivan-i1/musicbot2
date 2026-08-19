// commands/skip.js

const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track'),

  async execute(interaction) {
    const music = interaction.client.music;

    if (!interaction.inGuild() || !music.isConnected(interaction.guildId)) {
      await interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
      return;
    }

    const skipped = music.skip(interaction.guildId);
    await interaction.reply(skipped ? `⏭️ Skipped **${skipped.title}**` : 'Nothing is playing.');
  },
};
