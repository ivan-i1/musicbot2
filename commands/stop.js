// commands/stop.js

const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback, clear the queue and leave the voice channel'),

  async execute(interaction) {
    const music = interaction.client.music;

    if (!interaction.inGuild() || !music.isConnected(interaction.guildId)) {
      await interaction.reply({ content: 'I am not in a voice channel.', flags: MessageFlags.Ephemeral });
      return;
    }

    music.destroy(interaction.guildId);
    await interaction.reply('⏹️ Stopped, queue cleared.');
  },
};
