// commands/chat.js
//
// /chat — talk to the local model. Thin on purpose: every decision lives in
// chat/*.js, which is unit-tested; this file only sequences them. The
// generation step itself is chat/run.js, shared with @mention replies.
//
// Privacy: user messages, history and model output are NEVER logged. Only
// `[Chat]` event lines with channel id, duration, token counts and error
// class. That includes Discord errors — a DiscordAPIError carries the failed
// request body (the model's answer), so only its code is printed.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { cleanInput, cleanName, formatReply, MESSAGES } = require('../chat/format.js');
const { generateReply } = require('../chat/run.js');

const NO_MENTIONS = { parse: [] };

function refuse(interaction, content) {
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Talk to the bot (a small AI running on the home server)')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('What you want to say')
        .setRequired(true)
        .setMaxLength(500)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await refuse(interaction, MESSAGES.guildOnly);
      return;
    }

    const chat = interaction.client.chat;
    if (!chat?.config.enabled) {
      await refuse(interaction, MESSAGES.notConfigured);
      return;
    }

    const message = cleanInput(interaction.options.getString('message'));
    if (!message) {
      await refuse(interaction, MESSAGES.empty);
      return;
    }

    // admit() reserves a place synchronously — see chat/gate.js for the race
    // this closes. From here on the reservation must be run or cancelled.
    const admission = chat.gate.admit(interaction.user.id);
    if (!admission.ok) {
      await refuse(interaction, admission.reason === 'cooldown'
        ? MESSAGES.cooldown(admission.retryInS)
        : MESSAGES.busy);
      return;
    }
    const { ticket } = admission;

    // A cold prompt can take a minute — far past the 3s interaction deadline.
    try {
      await interaction.deferReply();
    } catch (error) {
      ticket.cancel();
      throw error;
    }

    const name = cleanName(interaction.member?.displayName ?? interaction.user.username);
    const result = await generateReply({ chat, ticket, channelId: interaction.channelId, name, message });
    const content = result.ok ? formatReply({ name, question: message, answer: result.answer }) : result.content;

    try {
      await interaction.editReply({ content, allowedMentions: NO_MENTIONS });
    } catch (error) {
      // Most likely the 15-minute interaction token expired. Nothing left to tell the user through.
      console.error(`[Chat] Could not edit the reply in ${interaction.channelId}: ${error.code ?? error.name}`);
    }
  },
};
