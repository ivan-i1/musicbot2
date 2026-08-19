// commands/mailbox.js

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { sendDmToUser } = require('../utils.js');
const { isAvailable } = require('../mailbox.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mailbox')
    .setDescription('Leave someone a message, delivered when they next come online')
    .addUserOption(option =>
      option.setName('person')
        .setDescription('The person to leave a message for')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The message to leave')
        .setRequired(true)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('person');
    const message = interaction.options.getString('message');

    if (target.bot) {
      await interaction.reply({
        content: 'Bots do not read their mail.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Presence lives on the guild member, not the user. It is null when the
    // member is not cached or the GuildPresences intent is off — either way,
    // "not known to be online" is the safe reading, and the message queues.
    let presence = null;
    try {
      const member = await interaction.guild?.members.fetch(target.id);
      presence = member?.presence ?? null;
    } catch (error) {
      console.error(`[Mailbox] Could not fetch member ${target.id}:`, error.message);
    }

    if (isAvailable(presence)) {
      const delivered = await sendDmToUser(
        interaction.client,
        target.id,
        `You have a new message from ${interaction.user.tag}:\n\n${message}`,
      );

      // sendDmToUser returns false for closed DMs — the previous version
      // ignored that and told the sender it had worked regardless.
      if (delivered) {
        await interaction.reply({
          content: `Delivered to ${target.username} — they were online.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        content: `${target.username} has DMs closed, so I could not deliver that.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    interaction.client.mailbox.add(target.id, {
      fromTag: interaction.user.tag,
      message,
    });

    await interaction.reply({
      content: `Saved. ${target.username} gets it when they next come online.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
