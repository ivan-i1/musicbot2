// commands/play.js

const { SlashCommandBuilder, MessageFlags, PermissionsBitField } = require('discord.js');
const { resolveTrack, TrackError } = require('../music/library.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a file from the music library, or an http(s) audio link')
    .addStringOption(option =>
      option.setName('track')
        .setDescription('File name inside the music library, or an http(s) URL')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'Music only works in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({
        content: 'Join a voice channel first, then ask me again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions?.has(PermissionsBitField.Flags.Connect) ||
        !permissions?.has(PermissionsBitField.Flags.Speak)) {
      await interaction.reply({
        content: `I need Connect and Speak permissions in ${voiceChannel.name}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let track;
    try {
      track = resolveTrack(interaction.options.getString('track'), {
        musicDir: interaction.client.musicDir,
      });
    } catch (error) {
      // TrackError messages are written to be shown to users; anything else
      // is a real fault and belongs in the logs, not in a Discord message.
      if (error instanceof TrackError) {
        await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
        return;
      }
      throw error;
    }

    track.requestedBy = interaction.user.tag;

    // Joining a voice channel can take a few seconds — past the 3s interaction
    // deadline — so acknowledge first.
    await interaction.deferReply();

    const music = interaction.client.music;
    await music.connect(voiceChannel);

    const ahead = music.queueFor(interaction.guildId).add(track);
    music.startIfIdle(interaction.guildId);

    await interaction.editReply(
      ahead === 0
        ? `▶️ Playing **${track.title}**`
        : `➕ Queued **${track.title}** — ${ahead} track(s) ahead of it.`,
    );
  },
};
