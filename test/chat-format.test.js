const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cleanInput,
  cleanName,
  escapeUserText,
  formatReply,
  capStoredAnswer,
  MAX_REPLY_CHARS,
  MAX_NAME_CHARS,
  STORED_ANSWER_CHARS,
  EMPTY_REPLY,
  MESSAGES,
} = require('../chat/format.js');

// --- cleanInput ---------------------------------------------------------------

test('cleanInput collapses newlines and runs of whitespace to single spaces', () => {
  assert.equal(cleanInput('  hola\n\nque   tal\t\r\nbot  '), 'hola que tal bot');
});

test('cleanInput rejects whitespace-only input as an empty string', () => {
  assert.equal(cleanInput(' \n\t '), '');
  assert.equal(cleanInput(''), '');
  assert.equal(cleanInput(null), '');
});

// --- cleanName ----------------------------------------------------------------

test('cleanName strips control characters and collapses whitespace', () => {
  assert.equal(cleanName('Ana\u0000\u0007 \n  María\u001b'), 'Ana María');
});

test('cleanName caps the name at 32 characters', () => {
  const name = cleanName('x'.repeat(50));
  assert.equal(name.length, MAX_NAME_CHARS);
  assert.equal(MAX_NAME_CHARS, 32);
});

test('cleanName falls back to "user" when nothing printable is left', () => {
  assert.equal(cleanName('\u0000\u0001  '), 'user');
  assert.equal(cleanName(undefined), 'user');
});

// --- escaping -----------------------------------------------------------------

test('escapeUserText escapes markdown emphasis', () => {
  assert.equal(escapeUserText('**bold** _it_'), '\\*\\*bold\\*\\* \\_it\\_');
});

test('escapeUserText neutralises masked links, which escapeMarkdown leaves intact', () => {
  const out = escapeUserText('[click](https://evil.example)');
  assert.ok(!/(^|[^\\])\[/.test(out), `unescaped [ in ${out}`);
  assert.ok(!/(^|[^\\])\]/.test(out), `unescaped ] in ${out}`);
});

test('escapeUserText escapes angle brackets so raw <@id> / <#id> forms do not render', () => {
  assert.equal(escapeUserText('<@123>'), '\\<@123\\>');
});

// --- formatReply --------------------------------------------------------------

test('formatReply quotes the asker and their question, then the answer', () => {
  assert.equal(
    formatReply({ name: 'Ana', question: 'hola?', answer: '¡Hola!' }),
    '> **Ana:** hola?\n¡Hola!',
  );
});

test('formatReply escapes markdown in the name and question but not in the answer', () => {
  const out = formatReply({ name: '*Ana*', question: '[x](y)', answer: '**yes**' });
  assert.equal(out, '> **\\*Ana\\*:** \\[x\\](y)\n**yes**');
});

test('formatReply never exceeds 2000 characters and trims the answer first', () => {
  const out = formatReply({ name: 'Ana', question: 'q'.repeat(500), answer: 'a'.repeat(5000) });

  assert.equal(MAX_REPLY_CHARS, 2000);
  assert.equal(out.length, MAX_REPLY_CHARS);
  assert.ok(out.startsWith(`> **Ana:** ${'q'.repeat(500)}\n`), 'the question is kept whole');
  assert.ok(out.endsWith('…'));
});

test('formatReply shows EMPTY_REPLY when the model returns nothing usable', () => {
  assert.equal(formatReply({ name: 'Ana', question: 'hm', answer: '  \n ' }), `> **Ana:** hm\n${EMPTY_REPLY}`);
  assert.equal(formatReply({ name: 'Ana', question: 'hm', answer: null }), `> **Ana:** hm\n${EMPTY_REPLY}`);
});

// --- history storage cap ------------------------------------------------------

test('capStoredAnswer limits stored assistant text to 600 characters', () => {
  assert.equal(STORED_ANSWER_CHARS, 600);
  assert.equal(capStoredAnswer('a'.repeat(1000)).length, 600);
  assert.equal(capStoredAnswer('short'), 'short');
});

// --- user-facing strings ------------------------------------------------------

test('all user-facing strings are exported for tests to assert on', () => {
  for (const key of ['notConfigured', 'guildOnly', 'empty', 'busy', 'offline', 'timeout']) {
    assert.equal(typeof MESSAGES[key], 'string', key);
  }
  assert.equal(typeof MESSAGES.cooldown(5), 'string');
  assert.match(MESSAGES.cooldown(7), /7 s/);
});
