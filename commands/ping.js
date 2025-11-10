// commands/ping.js

// Import the SlashCommandBuilder for building slash command definitions
const { SlashCommandBuilder } = require('discord.js');

// Export a module with the command data and an execute function
module.exports = {
  // data: Defines the command (name, description, etc.)
  data: new SlashCommandBuilder()
    .setName('ping') // The name of the command (e.g., /ping)
    .setDescription('Replies with Pong!'), // The description shown to the user

  // execute: The function that runs when the command is used
  async execute(interaction) {
    // interaction: The object containing all info about the command usage
    await interaction.reply('Pong!'); // Send a reply
  },
};