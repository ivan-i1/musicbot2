// deploy-commands.js

const { REST, Routes } = require('discord.js');
const path = require('node:path');
const { loadCommands } = require('./commandLoader.js');
require('dotenv').config(); // Load variables from .env

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // Your test server ID

// Grab the SlashCommandBuilder#toJSON() output of each valid command's data
const { commands: loaded, invalid } = loadCommands(path.join(__dirname, 'commands'));
const commands = loaded.map(command => command.data.toJSON());

for (const { file, reason } of invalid) {
  console.warn(`[WARNING] Not deploying command at ${file} — ${reason}`);
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token);

// and deploy your commands!
(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    // The put method is used to fully refresh all commands in the guild with the current set
    const data = await rest.put(
      // Use this route to deploy commands to a specific test server (GUILD)
      Routes.applicationGuildCommands(clientId, guildId),

      // Use this route to deploy commands globally (takes up to 1 hour to update)
      // Routes.applicationCommands(clientId),

      { body: commands },
    );

    console.log(`Successfully reloaded ${data.length} application (/) commands.`);
  } catch (error) {
    console.error(error);
  }
})();