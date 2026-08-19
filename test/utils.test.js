const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');

const { respondWithError } = require('../utils.js');

/** Minimal stand-in for a ChatInputCommandInteraction. */
function fakeInteraction({ replied = false, deferred = false } = {}) {
  const calls = [];
  return {
    replied,
    deferred,
    calls,
    async reply(options) { calls.push(['reply', options]); },
    async followUp(options) { calls.push(['followUp', options]); },
  };
}

test('replies ephemerally on a fresh interaction', async () => {
  const interaction = fakeInteraction();
  await respondWithError(interaction, 'boom');

  assert.equal(interaction.calls.length, 1);
  const [method, options] = interaction.calls[0];
  assert.equal(method, 'reply');
  assert.equal(options.content, 'boom');
});

test('uses flags, never the deprecated `ephemeral` boolean', async () => {
  const interaction = fakeInteraction();
  await respondWithError(interaction, 'boom');

  const [, options] = interaction.calls[0];
  assert.equal(options.flags, MessageFlags.Ephemeral);
  assert.ok(!('ephemeral' in options), '`ephemeral` is deprecated in discord.js v14.23');
});

test('follows up instead of replying when the interaction was already replied to', async () => {
  const interaction = fakeInteraction({ replied: true });
  await respondWithError(interaction, 'boom');

  assert.equal(interaction.calls[0][0], 'followUp',
    'a second reply() on a replied interaction throws InteractionAlreadyReplied');
});

test('follows up when the interaction was deferred', async () => {
  const interaction = fakeInteraction({ deferred: true });
  await respondWithError(interaction, 'boom');

  assert.equal(interaction.calls[0][0], 'followUp');
});

test('swallows a transport failure rather than throwing out of the error handler', async () => {
  const interaction = fakeInteraction();
  interaction.reply = async () => { throw new Error('token expired'); };

  await assert.doesNotReject(
    () => respondWithError(interaction, 'boom'),
    'the error handler must not itself become an unhandled rejection',
  );
});
