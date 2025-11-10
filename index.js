// index.js

const fs = require('node:fs');
const path = require('node:path');
// Require the necessary discord.js classes
const { Client, Collection, GatewayIntentBits } = require('discord.js');
require('dotenv').config(); // Load variables from .env

const token = process.env.DISCORD_TOKEN;

// 1. Create a new Client instance
// const client = new Client({
//   // Define the 'Intents' (permissions) your bot needs
//   intents: [
//     GatewayIntentBits.Guilds, // Required for basic server functionality
//     // Add other intents here if your bot needs them
//   ],
// });
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.MessageContent, // You added this, perfect!
    GatewayIntentBits.GuildMessages, // Add this to explicitly listen for channel messages
    GatewayIntentBits.GuildMembers,
  ],
});

// 2. Load Command Files
// 'client.commands' will store all of your command definitions
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  // Set a new item in the Collection with the key as the command name
  // and the value as the exported module
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
  }
}

// 3. Event Listener: When the bot is ready
client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

// 4. Event Listener: When an interaction (slash command) is used
client.on('interactionCreate', async interaction => {
  // Ignore any interaction that is not a slash command
  if (!interaction.isChatInputCommand()) return;

  // Get the command from the client.commands collection
  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  // Try to execute the command
  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
  }
});

client.on('connection', () => {
  console.log('Bot is connected to Discord!');
});

// 5. NEW: Event Listener: When a message is created
client.on('messageCreate', async message => {
  // 5a. Ignore messages from other bots (and itself)
  // This is crucial to prevent your bot from replying to itself in a loop
  if (message.author.bot) {
    return;
  }

  // 5b. (Optional) Only track specific channels
  // This is highly recommended! You don't want to track #general or #memes.
  // Get the channel ID by right-clicking it in Discord -> "Copy ID"
  // const allowedChannelId = 'YOUR_TRACKING_CHANNEL_ID_HERE';
  // if (message.channel.id !== allowedChannelId) {
  //   return;
  // }

  // 5c. Get the message content
  const content = message.content;

  // 5d. Perform your calculations (just like in the /count command)
  const charCount = content.length;
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  // 5e. Log the data for "tracking"
  // We use console.log instead of message.reply() to be passive!
  console.log(`[Tracking] User: ${message.author.tag} | Channel: ${message.channel.name} | Words: ${wordCount} | Chars: ${charCount}`);
  
  // You could also check for specific keywords for gaming:
  if (content.toLowerCase().includes('lfg')) {
    console.log(`[Tracking] User: ${message.author.tag} is looking for a group!`);
    // You could add logic here to give them a special role or log it to a database
  }
});

// 5. Log in to Discord with your client's token
client.login(token);

