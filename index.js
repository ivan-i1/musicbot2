// index.js

const path = require('node:path');
// Require the necessary discord.js classes
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { loadCommands } = require('./commandLoader.js');
const { respondWithError } = require('./utils.js');
const { parseTrackedChannels, shouldTrack, messageStats } = require('./tracking.js');
const { MailboxStore, becameAvailable } = require('./mailbox.js');
const { sendDmToUser } = require('./utils.js');
const { MusicManager } = require('./music/player.js');
require('dotenv').config(); // Load variables from .env

const token = process.env.DISCORD_TOKEN;

// OPT-IN. Set TRACKED_CHANNEL_IDS in .env to a comma-separated list of channel
// IDs. With nothing configured the bot tracks nothing at all — it will not log
// every message in every channel it can see.
const trackedChannelIds = parseTrackedChannels(process.env.TRACKED_CHANNEL_IDS);


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
    GatewayIntentBits.GuildPresences, // privileged — required for /mailbox deferred delivery
    GatewayIntentBits.GuildVoiceStates, // NOT privileged — required to see who is in voice
  ],
});

// Mailbox store — queued messages must outlive a restart, so this is
// file-backed. Commands reach it via interaction.client.mailbox.
client.mailbox = new MailboxStore(path.join(__dirname, 'data', 'mailbox.json'));

// Music playback. MUSIC_DIR confines /play to one directory — see
// music/library.js for why that boundary is not optional.
client.music = new MusicManager();
client.musicDir = process.env.MUSIC_DIR || null;

// 2. Load Command Files
// 'client.commands' will store all of your command definitions
client.commands = new Collection();
const { commands, invalid } = loadCommands(path.join(__dirname, 'commands'));

for (const command of commands) {
  client.commands.set(command.data.name, command);
}
for (const { file, reason } of invalid) {
  console.warn(`[WARNING] Skipping command at ${file} — ${reason}`);
}

// 3. Event Listener: When the bot is ready
client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}!`);

  console.log(client.musicDir
    ? `[Music] Library: ${client.musicDir}`
    : '[Music] No MUSIC_DIR set — /play accepts http(s) links only.');

  if (trackedChannelIds.length === 0) {
    console.log('[Tracking] Disabled — set TRACKED_CHANNEL_IDS in .env to enable.');
  } else {
    console.log(`[Tracking] Enabled for ${trackedChannelIds.length} channel(s).`);
  }
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
    console.error(`[Command Error] /${interaction.commandName} threw:`, error);
    await respondWithError(interaction, 'There was an error while executing this command!');
  }
});

// 5. Event Listener: deliver queued mailbox messages
//
// This is the half of /mailbox that makes it deferred rather than instant:
// the command queues for an offline user, and this fires when they return.
client.on('presenceUpdate', async (oldPresence, newPresence) => {
  if (!becameAvailable(oldPresence, newPresence)) return;

  const userId = newPresence?.userId;
  if (!userId) return;

  // takeFor drains and persists BEFORE we deliver: a crash mid-send loses a
  // message rather than re-delivering it on every restart.
  const pending = client.mailbox.takeFor(userId);
  if (pending.length === 0) return;

  console.log(`[Mailbox] ${userId} came online — delivering ${pending.length} message(s).`);

  for (const { fromTag, message, queuedAt } of pending) {
    await sendDmToUser(
      client,
      userId,
      `You have a message from ${fromTag} (left ${queuedAt}):\n\n${message}`,
    );
  }
});

// 6. Event Listener: passive message tracking
client.on('messageCreate', async message => {
  if (!shouldTrack(message, trackedChannelIds)) return;

  const { charCount, wordCount, lookingForGroup } = messageStats(message.content);

  console.log(
    `[Tracking] User: ${message.author.tag} | Channel: ${message.channel.name} | ` +
    `Words: ${wordCount} | Chars: ${charCount}`,
  );

  if (lookingForGroup) {
    console.log(`[Tracking] User: ${message.author.tag} is looking for a group!`);
  }
});

// 5. Log in to Discord with your client's token
client.login(token);

