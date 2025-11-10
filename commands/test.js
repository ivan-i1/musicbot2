// commands/test.js

// Import the SlashCommandBuilder for building slash command definitions
const { SlashCommandBuilder } = require('discord.js');

// Export a module with the command data and an execute function
module.exports = {
  // data: Defines the command (name, description, etc.)
  data: new SlashCommandBuilder()
    .setName('test') // The name of the command (e.g., /ping)
    .setDescription('Current idea')
    .addStringOption(option =>
      option.setName('input')
        .setDescription('The input to process')
        .setRequired(true)
    ),

  // execute: The function that runs when the command is used
  async execute(interaction) {
    // interaction: The object containing all info about the command usage
    // generate a random number between 1 and 100
    const randomNumber = Math.floor(Math.random() * 100) + 1;
    console.log('Random Number: ', randomNumber);
    console.log('Interaction: ', interaction);
    console.log('Input: ', interaction.options.getString('input'));
    await interaction.reply('Pong!'); // Send a reply
  },
};