const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadCommands } = require('../commandLoader.js');

/** Build a throwaway commands dir so tests never depend on the real one. */
function fixtureDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdload-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

const VALID = `module.exports = {
  data: { name: 'alpha', toJSON: () => ({ name: 'alpha' }) },
  execute: async () => {},
};`;

test('loads a module exporting both data and execute', () => {
  const dir = fixtureDir({ 'alpha.js': VALID });
  const { commands, invalid } = loadCommands(dir);

  assert.equal(commands.length, 1);
  assert.equal(commands[0].data.name, 'alpha');
  assert.deepEqual(invalid, []);
});

test('reports a module missing execute as invalid instead of loading it', () => {
  const dir = fixtureDir({ 'broken.js': `module.exports = { data: { name: 'broken' } };` });
  const { commands, invalid } = loadCommands(dir);

  assert.deepEqual(commands, []);
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reason, /execute/);
});

test('reports a module missing data as invalid', () => {
  const dir = fixtureDir({ 'broken.js': `module.exports = { execute: async () => {} };` });
  const { commands, invalid } = loadCommands(dir);

  assert.deepEqual(commands, []);
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reason, /data/);
});

test('a command file that throws on require is reported, not fatal', () => {
  const dir = fixtureDir({ 'boom.js': `throw new Error('kaboom');`, 'alpha.js': VALID });
  const { commands, invalid } = loadCommands(dir);

  assert.equal(commands.length, 1, 'the healthy command still loads');
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reason, /kaboom/);
});

test('ignores non-js files', () => {
  const dir = fixtureDir({ 'alpha.js': VALID, 'notes.md': '# hi', 'data.json': '{}' });
  const { commands } = loadCommands(dir);

  assert.equal(commands.length, 1);
});

test('every real command in commands/ satisfies the contract', () => {
  const { commands, invalid } = loadCommands(path.join(__dirname, '..', 'commands'));

  assert.deepEqual(invalid, [], 'no command file may be silently skipped');
  assert.ok(commands.length >= 4);
});

test('a BARE relative directory works — require() would treat it as a package name', () => {
  // The real trap: path.join('commands', 'play.js') === 'commands/play.js',
  // with no leading './'. require() resolves that through node_modules, not
  // the filesystem, so every command came back invalid.
  const { commands, invalid } = loadCommands('commands');

  assert.deepEqual(invalid, [], 'a bare relative path must not be read as a package specifier');
  assert.ok(commands.length >= 4);
});
