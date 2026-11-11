const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageType } = require('discord.js');

const { stripQuotesAndCode, isMentionTrigger, extractPrompt } = require('../chat/mention.js');

const BOT = '1000';
const ROLE = '2000';
const ids = { botId: BOT, botRoleId: ROLE };

/** Just the fields isMentionTrigger reads. */
function msg(content, overrides = {}) {
  return {
    content,
    type: MessageType.Default,
    guildId: 'guild-1',
    author: { id: 'u1', bot: false },
    webhookId: null,
    ...overrides,
  };
}

const triggers = (content, overrides, options = ids) => isMentionTrigger(msg(content, overrides), options);

// --- stripQuotesAndCode --------------------------------------------------------

test('stripQuotesAndCode: fenced and inline code become [code]', () => {
  assert.equal(stripQuotesAndCode('a ```js\nx <@1>\n``` b `y` c'), 'a [code] b [code] c');
});

test('stripQuotesAndCode: a > inside a fence is code, not a quote', () => {
  assert.equal(stripQuotesAndCode('```\n> not a quote\n```\nhi'), '[code]\nhi');
});

test('stripQuotesAndCode: >>> cuts to the end, > lines are dropped, >5 is kept', () => {
  assert.equal(stripQuotesAndCode('keep\n> quoted\n>5 stays\n>>> gone\nalso gone'), 'keep\n>5 stays\n');
});

// --- isMentionTrigger: triggers -----------------------------------------------

test('<@bot> triggers', () => assert.equal(triggers(`<@${BOT}> hi`), true));
test('the legacy <@!bot> form triggers', () => assert.equal(triggers(`<@!${BOT}> hi`), true));
test('the bot\'s managed role <@&role> triggers', () => assert.equal(triggers(`<@&${ROLE}> hi`), true));
test('a reply-type message that @mentions the bot triggers', () =>
  assert.equal(triggers(`<@${BOT}> hi`, { type: MessageType.Reply }), true));
test('>5 <@bot> triggers: no space after >, so not a quote', () => assert.equal(triggers(`>5 <@${BOT}>`), true));
test('a quote line followed by an unquoted mention triggers', () =>
  assert.equal(triggers(`> quote\n<@${BOT}> hi`), true));
test('a mention among others still triggers', () => assert.equal(triggers(`<@3000> and <@${BOT}> hi`), true));

// --- isMentionTrigger: ignored ------------------------------------------------

test('@everyone alone does not trigger', () => assert.equal(triggers('@everyone hi'), false));
test('another role does not trigger', () => assert.equal(triggers('<@&9999> hi'), false));
test('a mention only on a > line does not trigger', () => assert.equal(triggers(`> <@${BOT}> hi\nhello`), false));
test('a mention inside a >>> block does not trigger', () => assert.equal(triggers(`>>> hey <@${BOT}>`), false));
test('>>> runs to the end of the message', () => assert.equal(triggers(`>>> x\n<@${BOT}>`), false));
test('a bot author does not trigger', () => assert.equal(triggers(`<@${BOT}> hi`, { author: { id: 'b', bot: true } }), false));
test('a webhook does not trigger', () => assert.equal(triggers(`<@${BOT}> hi`, { webhookId: 'w1' }), false));
test('a DM does not trigger', () => assert.equal(triggers(`<@${BOT}> hi`, { guildId: null }), false));
test('a system message does not trigger', () =>
  assert.equal(triggers(`<@${BOT}> hi`, { type: MessageType.UserJoin }), false));
test('a reply to the bot without <@bot> in the content does not trigger', () =>
  assert.equal(triggers('thanks!', { type: MessageType.Reply }), false));
test('`<@bot>` in inline code does not trigger', () => assert.equal(triggers(`look: \`<@${BOT}>\``), false));
test('a mention inside a fenced block does not trigger', () =>
  assert.equal(triggers(`\`\`\`\n<@${BOT}>\n\`\`\``), false));
test('empty or missing content does not trigger', () => {
  assert.equal(triggers(''), false);
  assert.equal(triggers(undefined), false);
});

test('without botRoleId the role trigger is off and the user trigger still works', () => {
  assert.equal(triggers(`<@&${ROLE}> hi`, {}, { botId: BOT, botRoleId: null }), false);
  assert.equal(triggers(`<@${BOT}> hi`, {}, { botId: BOT, botRoleId: null }), true);
});

// --- extractPrompt ------------------------------------------------------------

const nameOf = id => ({ 3000: 'Luis' })[id] ?? 'someone';
const prompt = (content, extra = {}) => extractPrompt(content, { ...ids, nameOf, ...extra });

test('extractPrompt strips the bot user and role mentions', () => {
  assert.equal(prompt(`<@${BOT}> hola <@!${BOT}> que <@&${ROLE}> tal`), 'hola que tal');
});

test('extractPrompt drops quoted lines and >>> blocks', () => {
  assert.equal(prompt(`> earlier stuff\n<@${BOT}> what now?\n>>> pasted\nblock`), 'what now?');
});

test('extractPrompt turns code into [code]', () => {
  assert.equal(prompt(`<@${BOT}> why does \`x()\` fail?\n\`\`\`\nboom\n\`\`\``), 'why does [code] fail? [code]');
});

test('extractPrompt names other users and neutralises roles and channels', () => {
  assert.equal(prompt(`<@${BOT}> say hi to <@3000>, <@!4000>, <@&9999> in <#5000>`),
    'say hi to @Luis, @someone, @role in #channel');
});

test('extractPrompt sanitises names from nameOf', () => {
  assert.equal(prompt(`<@${BOT}> hi <@3000>`, { nameOf: () => 'A\u0000\nB' }), 'hi @A B');
});

test('extractPrompt: exactly 500 characters is unchanged, 501 becomes 499 + …', () => {
  const exact = 'a'.repeat(500);
  assert.equal(prompt(`<@${BOT}> ${exact}`), exact);
  const over = prompt(`<@${BOT}> ${'b'.repeat(501)}`);
  assert.equal(over.length, 500);
  assert.equal(over, `${'b'.repeat(499)}…`);
});

test('extractPrompt honours maxChars', () => {
  assert.equal(prompt(`<@${BOT}> abcdef`, { maxChars: 4 }), 'abc…');
});

test('extractPrompt: a mention alone (or with only quotes) gives \'\'', () => {
  assert.equal(prompt(`<@${BOT}>`), '');
  assert.equal(prompt(`  <@${BOT}>  \n> quoted`), '');
});
