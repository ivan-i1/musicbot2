const { MessageFlags } = require('discord.js');

/**
 * [HELPER FUNCTION] Sends a direct message to a specific user.
 * This is your "internal command".
 *
 * @param {Client} client - The Discord client instance.
 * @param {string} userId - The ID of the user to message.
 * @param {string|object} messageContent - The message to send (string, embed, etc.).
 * @returns {Promise<boolean>} - True if successful, false otherwise.
 */
async function sendDmToUser(client, userId, messageContent) {
  try {
    // 1. Fetch the user object from Discord using their ID
    const user = await client.users.fetch(userId);

    if (!user) {
      console.error(`[DM Error] Could not find user with ID: ${userId}`);
      return false;
    }

    // 2. Send the direct message
    await user.send(messageContent);
    
    console.log(`[DM Success] Sent message to ${user.tag} (ID: ${userId})`);
    return true;

  } catch (error) {
    // 3. Handle common errors
    if (error.code === 50007) { // "Cannot send messages to this user"
      console.error(`[DM Error] Could not send DM to user ${userId}. They may have DMs disabled or have blocked the bot.`);
    } else if (error.code === 10013) { // "Unknown User"
      console.error(`[DM Error] Invalid user ID provided: ${userId}`);
    } else {
      console.error(`[DM Error] An unexpected error occurred while sending DM to ${userId}:`, error);
    }
    return false;
  }
}

/**
 * [HELPER FUNCTION] Reports a command failure back to the user, safely.
 *
 * Two traps this exists to avoid:
 *  1. Calling `interaction.reply()` on an interaction that was already
 *     replied to or deferred throws `InteractionAlreadyReplied` — so an error
 *     handler written as a bare `reply()` turns one failure into two, the
 *     second one unhandled.
 *  2. `{ ephemeral: true }` is deprecated as of discord.js v14.23 in favour of
 *     `{ flags: MessageFlags.Ephemeral }`.
 *
 * Never throws: if the response itself fails (expired token, lost gateway),
 * it logs and returns false. An error handler that can throw is not one.
 *
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {string} content - user-facing message.
 * @returns {Promise<boolean>} - true if the user was told, false otherwise.
 */
async function respondWithError(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
    return true;
  } catch (error) {
    console.error('[Reply Error] Could not deliver the error message to the user:', error);
    return false;
  }
}

module.exports = { sendDmToUser, respondWithError };