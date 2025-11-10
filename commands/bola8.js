// commands/bola8.js

// Import the SlashCommandBuilder for building slash command definitions
const { SlashCommandBuilder } = require('discord.js');

// Export a module with the command data and an execute function
module.exports = {
  // data: Defines the command (name, description, etc.)
  data: new SlashCommandBuilder()
    .setName('bola8') // The name of the command (e.g., /ping)
    .setDescription('¿Sera o no sera?'),

  // execute: The function that runs when the command is used
  async execute(interaction) {
    // interaction: The object containing all info about the command usage
    const anwsers = [
      'SI',
      'NO',
    ]
    const response = anwsers[Math.floor(Math.random() * anwsers.length)];
    await interaction.reply(response);
  },
};