// commandLoader.js
//
// Reads a directory of command modules and splits them into the ones that
// satisfy the contract (export both `data` and `execute`) and the ones that
// do not. Kept as a plain function so it can be unit-tested without a live
// Discord client — index.js and deploy-commands.js both consume it, so the
// two can no longer drift apart.

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} commandsPath - directory to scan for `.js` command modules.
 * @returns {{commands: Array<object>, invalid: Array<{file: string, reason: string}>}}
 */
function loadCommands(commandsPath) {
  const commands = [];
  const invalid = [];

  // require() resolves a relative path against THIS module, not the caller's
  // cwd, so a relative commandsPath would report every command as invalid.
  const root = path.resolve(commandsPath);
  const files = fs.readdirSync(root).filter(file => file.endsWith('.js'));

  for (const file of files) {
    const filePath = path.join(root, file);
    let command;

    try {
      command = require(filePath);
    } catch (error) {
      // A command that blows up on require must not take the whole bot down.
      invalid.push({ file: filePath, reason: `failed to load: ${error.message}` });
      continue;
    }

    const missing = [];
    if (!command || !('data' in command)) missing.push('data');
    if (!command || !('execute' in command)) missing.push('execute');

    if (missing.length > 0) {
      invalid.push({ file: filePath, reason: `missing required property: ${missing.join(', ')}` });
      continue;
    }

    commands.push(command);
  }

  return { commands, invalid };
}

module.exports = { loadCommands };
