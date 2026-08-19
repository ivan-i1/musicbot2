// commands/nowplaying.js

const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the track currently playing'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'Music only works in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const { current } = interaction.client.music.queueFor(interaction.guildId);

    if (!current) {
      await interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
      return;
    }

    const requester = current.requestedBy ? ` — requested by ${current.requestedBy}` : '';
    await interaction.reply(`▶️ **${current.title}**${requester}`);
  },
};
