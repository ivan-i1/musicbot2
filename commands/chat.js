// commands/chat.js
//
// /chat — talk to the local model. Thin on purpose: every decision lives in
// chat/*.js, which is unit-tested; this file only sequences them.
//
// Privacy: user messages, history and model output are NEVER logged. Only
// `[Chat]` event lines with channel id, duration, token counts and error
// class. That includes Discord errors — a DiscordAPIError carries the failed
// request body (the model's answer), so only its code is printed.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { cleanInput, cleanName, formatReply, MESSAGES } = require('../chat/format.js');
const { ChatTimeoutError, ChatUnavailableError } = require('../chat/provider.js');

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

    const { config, history, provider } = chat;
    const channelId = interaction.channelId;
    const name = cleanName(interaction.member?.displayName ?? interaction.user.username);
    const started = Date.now();

    let content;
    try {
      const { text, finishReason, usage } = await ticket.run(() => provider.complete({
        // Built at job start, so it includes exchanges that finished while
        // this one waited in the queue.
        messages: history.build(channelId, {
          systemPrompt: config.systemPrompt,
          name,
          message,
          budgetChars: config.historyChars,
        }),
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        // Created INSIDE the job: time spent queued must not eat the timeout.
        signal: AbortSignal.timeout(config.timeoutMs),
      }));

      const answer = text.trim();
      if (answer) history.append(channelId, { name, user: message, assistant: answer });
      content = formatReply({ name, question: message, answer });

      console.log(
        `[Chat] Reply in ${channelId} after ${Date.now() - started} ms ` +
        `(prompt ${usage?.promptTokens ?? '?'} tok, completion ${usage?.completionTokens ?? '?'} tok, ` +
        `finish ${finishReason ?? '?'}${answer ? '' : ', empty'})`,
      );
    } catch (error) {
      if (error instanceof ChatTimeoutError) {
        content = MESSAGES.timeout;
      } else if (error instanceof ChatUnavailableError) {
        content = MESSAGES.offline;
      } else {
        throw error;
      }
      console.error(`[Chat] ${error.name} in ${channelId} after ${Date.now() - started} ms: ${error.message}`);
    }

    try {
      await interaction.editReply({ content, allowedMentions: NO_MENTIONS });
    } catch (error) {
      // Most likely the 15-minute interaction token expired. Nothing left to tell the user through.
      console.error(`[Chat] Could not edit the reply in ${channelId}: ${error.code ?? error.name}`);
    }
  },
};
