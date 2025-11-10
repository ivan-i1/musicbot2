// commands/mailbox.js

// Import the SlashCommandBuilder for building slash command definitions
const { SlashCommandBuilder } = require('discord.js');
const { sendDmToUser } = require('../utils.js');

// Export a module with the command data and an execute function
module.exports = {
  // data: Defines the command (name, description, etc.)
  data: new SlashCommandBuilder()
    .setName('mailbox') // The name of the command (e.g., /ping)
    .setDescription('Get a mention once mentioned person is online')
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

  // execute: The function that runs when the command is used
  async execute(interaction) {
    // interaction: The object containing all info about the command usage
    // console.log('Interaction: ', interaction);
    console.log('Input: ', interaction.options.getString('message'));
    await sendDmToUser(interaction.client, interaction.options.getUser('person').id, `You have a new message from ${interaction.user.tag}:\n\n${interaction.options.getString('message')}`);
    await interaction.reply('Message in Mailbox!'); // Send a reply
  },
};