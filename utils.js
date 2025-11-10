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

module.exports = { sendDmToUser };