# MENTION_CHAT_PLAN — reply to @mentions with the local model (musicbot2)

> Task: `MUSICBOT2 TASK mention-chat` (follow-up to #4 `MUSICBOT2 MAIN local-llm-chat`; estimate 3 h). Approved 2026-11-11.

## 1. Goal
Typing `/chat` every time is tiresome. The bot should also answer when it is @mentioned in an ordinary guild message.
It reuses the same model, limits and per-channel memory as `/chat`, so the heat budget and behaviour stay identical.

## 2. Status (2026-11-10)
- `/chat` is live at `aa68e96`, deployed and checked.
- Research is done: three agents covering the discord.js code paths, Discord policy and the abuse/load risks.
- Story confirmed: @ only (replies without @ don't count), all channels.
- **2026-11-11: §7 steps 1–5 implemented on `feat/chat-llm`** (not shipped, not deployed):
  `chat/run.js` (+ `/chat` refactored onto it, its tests unchanged), `chat/mention.js`, `chat/respond.js`,
  `test/helpers/fakeMessage.js`, the second `messageCreate` listener in `index.js`, and the `CLAUDE.md`/`README.md`
  docs. Every §8 item has a red-first test; `npm test` went from 157 to 222 passing.
- Remaining: §7 step 6 (`/ship`), 7 (deploy) and 8 (live verification with the user).

## 3. Current state (code-checked, worktree `.claude/worktrees/chat-llm` @ `aa68e96`)
- **Intents:** `Guilds`, `MessageContent` and `GuildMessages` are already requested (`index.js:33-35`). There is one `messageCreate` listener, for tracking only (`index.js:133`), and its `shouldTrack` ignores bots (`tracking.js:32`). A second listener can coexist. No Developer Portal change is needed; per Discord's 2026-06-10 policy, intent review is now by user count (<10k self-serve).
- **`client.chat = createChat(process.env)`** (`index.js:53`) bundles `config`, `history`, `gate` and `provider` (`chat/index.js:19-29`). The provider is null when disabled.
- **The `/chat` generation step** lives inline in `commands/chat.js:69-109`: build history, `ticket.run(provider.complete(...))` with the signal created inside the job, append on a non-empty answer, log `[Chat]` without content, and map `ChatTimeoutError`/`ChatUnavailableError` to `MESSAGES`.
- **Format helpers** (`chat/format.js`): `cleanInput` (:37), `cleanName` (:42), `truncate` (:52), `formatReply` (:61, quotes the question, which a threaded reply doesn't need), `MESSAGES` (:23), `EMPTY_REPLY` (:21).
- **discord.js 14.27:**
  - `message.mentions.has(user, {ignoreEveryone, ignoreRoles, ignoreRepliedUser})` (`MessageMentions.js:260-284`). With `ignoreRepliedUser`, the bot's `<@id>` must be literally present.
  - The bot's managed role is `guild.members.me.roles.botRole` (`GuildMemberRoleManager.js:106`).
  - `message.reply` (`Message.js:982`) accepts `allowedMentions.repliedUser` (mapped in `MessagePayload.js:182`) and `failIfNotExists` (default true, `Options.js:120`).
  - `channel.sendTyping()` (`TextBasedChannel.js:207`); the indicator expires after 10 s.
  - Thread permissions come from the parent (`ThreadChannel.js:283`).
- **Tests:** `test/helpers/fakeInteraction.js` pattern; the suite has 157 passing tests.

## 4. User story (confirmed 2026-11-10)
As a server member, I want to write `@musicbot02 <message>` in a normal channel message and get a reply, so that I can
chat without typing `/chat`.

☀️
1. A mention of the bot user, or its managed role, outside `>` quotes triggers it.
2. The shared gate admits the request; typing is shown and refreshed every 8 s until done.
3. The prompt is cleaned: mention stripped, quoted lines dropped, code blocks → `[code]`, other `<@id>` → display names, ≤500 characters with "…".
4. Same channel history as `/chat`.
5. `message.reply` with no pings at all.

🌧️
| Case | Behaviour |
|---|---|
| Only @everyone/@here, another role, or the bot mentioned only inside a quote | Ignored |
| Reply to the bot without @ | Ignored |
| Bot or webhook author, system message, DM | Ignored |
| Edit | Ignored (no `messageUpdate` listener) |
| Empty after cleaning | Ignored silently |
| Cooldown (shared with /chat) | 🧊 reaction, at most once per user per cooldown window |
| Queue full (shared) | ⏳ reaction |
| Offline or timeout | Short text reply (`MESSAGES.offline` / `.timeout`) |
| Missing permissions (View/Send or SendInThreads, ReadMessageHistory) | Silent, with one `[Chat]` log line |
| Missing AddReactions | Cooldown/busy feedback silently skipped; replies still work |
| Original message deleted before the reply | `failIfNotExists: false`, so it's sent as a plain message |
| Chat disabled | Ignored silently |
| Other people mentioned too | Still answered |

No message content is logged, and replied-to or older messages are never fetched.

## 5. Design

### 5.1 `chat/mention.js` (pure)
- **`stripQuotesAndCode(content)`** is used by both functions below, so a mention inside code or a quote never triggers. It applies Discord's rules:
  1. Remove fenced and inline code first, so a `>` inside a fence is not a quote. Code becomes `[code]` in the prompt.
  2. Then cut from the first line-start `>>> ` to the end of the message.
  3. Then drop single-line quotes, meaning lines that match `^\s*>\s` (with a space). A bare `>5` is not a quote.
- **`isMentionTrigger(message, {botId, botRoleId})`** returns false when:
  - the message is in a DM, from a bot (`author.bot`), from a webhook (`webhookId`), or not a `Default`/`Reply` type;
  - after `stripQuotesAndCode`, the remaining text contains neither `<@botId>`/`<@!botId>` nor `<@&botRoleId>`. If `botRoleId` is missing, the role trigger is silently off.

  It works on raw content, not `mentions.has`, because quoted mentions still appear in `mentions`. That makes the function fully pure and testable.
- **`extractPrompt(content, {botId, botRoleId, nameOf, maxChars = 500})`:**
  1–2. `stripQuotesAndCode` (code → `[code]` first, then quotes, exactly as the trigger check does).
  3. Remove bot user and role mentions.
  4. Replace the remaining `<@id>`/`<@!id>` with `@<nameOf(id)>`, `<@&id>` with `@role` and `<#id>` with `#channel`.
  5. `cleanInput`, then `truncate` to `maxChars` (keep 499 characters plus "…").
  6. Return `''` if empty.

### 5.2 `chat/run.js` (shared generation, extracted from `commands/chat.js:69-109`)
- `generateReply({chat, ticket, channelId, name, message})` returns `{ok:true, answer}` or `{ok:false, content}`, and logs the `[Chat]` line.
- It builds history inside the job, creates `AbortSignal.timeout` inside the job, appends on a non-empty answer, and maps timeout/unavailable errors to `MESSAGES`.
- Unknown errors are rethrown.
- `commands/chat.js` is refactored to call it, with unchanged behaviour; the existing `/chat` tests are the regression gate.

### 5.3 `chat/respond.js` — `respondToMention(message, {chat, botId, botRoleId, setInterval, clearInterval})`
1. If `!chat?.config.enabled`, return.
2. Check permissions with `channel.permissionsFor(guild.members.me)`: `ViewChannel` + `ReadMessageHistory` + (`SendMessagesInThreads` if the channel is a thread, else `SendMessages`). A **null result**, from a missing `me` or a thread with no parent (`ThreadChannel.js:283`), counts as missing. If any is missing, log `[Chat] Missing permission <name> in <channelId>` and return.
3. `const prompt = extractPrompt(message.content, {botId, botRoleId, nameOf})`, with `nameOf` as in §5.3a. If empty, return.
4. `const admission = chat.gate.admit(author.id)`. If `!admission.ok`, react with `🧊` for cooldown or `⏳` for busy, then **return**. Otherwise `const { ticket } = admission`. Reaction rules:
   - The reaction is **deduped per user**: at most one reaction per user per cooldown window, tracked in a `Map` that is pruned of entries older than the cooldown on every call, so a spammer can't flood reactions.
   - Reactions need `AddReactions`; skip them if it's missing. All reaction errors are swallowed.
5. **Everything from a successful admit until `ticket.run` sits inside try/catch, calling `ticket.cancel()` on a throw.** A leaked reservation would block the queue permanently (`gate.js:50-61`; the same guard as `commands/chat.js:63-67`).
6. Start typing right away, then every 8 s. The interval is cleared **before** the reply is sent, and again in `finally`. `sendTyping` errors are swallowed.
7. `generateReply({chat, ticket, channelId: message.channelId, name, message: prompt})`. The name is `cleanName(message.member?.displayName ?? author.username)`. `nameOf(id)` reads `message.mentions.members`/`users` from the cache and never fetches.
8. `message.reply({content: answer ? truncate(answer, 2000) : EMPTY_REPLY, allowedMentions: {parse: [], repliedUser: false}, failIfNotExists: false})`, or the friendly `content` on failure. A reply error logs only `error.code`.

- `[Chat] Missing permission` is logged at most once per channel per hour, to avoid log spam. 🧊 and ⏳ are Unicode, so no emoji permission is needed.

### 5.3a Test helper — `test/helpers/fakeMessage.js`
- **Fields:** `{content, type (MessageType.Default), author:{id, bot, username}, webhookId, guildId, guild:{members:{me}}, member:{displayName}, mentions:{users, members} (Maps id→{displayName|username}), channel:{id, isThread(), permissionsFor(me)→{has(flag)}|null, sendTyping()}}`.
- **Recorded calls:** `react(emoji)`, `reply(options)`, with errors injectable.
- **`nameOf`:** `id => message.mentions.members.get(id)?.displayName ?? message.mentions.users.get(id)?.username ?? 'someone'`. It's built from the message, cached, and never fetches.

### 5.4 Wiring — `index.js`
Add a second `client.on('messageCreate', …)`:
```js
const botId = client.user.id;
const botRoleId = message.guild?.members.me?.roles.botRole?.id ?? null;
if (!isMentionTrigger(message, { botId, botRoleId })) return;
await respondToMention(message, { chat: client.chat, botId, botRoleId });
```
Errors are caught and logged as `[Chat] mention handler failed: <code|name>`. The tracking listener stays untouched.

### 5.5 Config
No new env keys. `LLM_MENTION_CHANNEL_IDS` is deferred.

## 6. Code touches
| File | Change |
|---|---|
| `chat/mention.js`, `chat/run.js`, `chat/respond.js` | new |
| `commands/chat.js` | use `generateReply` (behaviour unchanged) |
| `chat/format.js` | export `truncate`/`ELLIPSIS` if not already exported |
| `index.js` | second `messageCreate` listener |
| `test/chat-mention.test.js`, `test/chat-run.test.js`, `test/chat-respond.test.js`, `test/helpers/fakeMessage.js` | new |
| `CLAUDE.md` Chat paragraph (mention trigger, shared gate and history, privacy: no content logged, no other messages fetched) and `README.md` (usage line, required channel permissions: View, Send/SendInThreads, Read History, Add Reactions; link to `MENTION_CHAT_PLAN.md`) | docs |

## 7. Implementation order
1. Work in the existing worktree `.claude/worktrees/chat-llm`, fast-forwarded to `origin/main` `aa68e96` (it already is).
2. Write `chat/run.js` test-first. Refactor `commands/chat.js` onto it; all 157 tests must stay green.
3. Write `chat/mention.js` test-first.
4. Write `chat/respond.js` test-first, with a fake message and channel, `mock.timers` for typing, and a stub gate and provider.
5. Wire `index.js` and update the docs. Full suite green.
6. `/ship`.
7. Deploy, which restarts only the bot (the `llm` container is unchanged):
   1. `docker tag musicbot2:local musicbot2:pre-mention` (undo).
   2. Extract `origin/main` with `git archive`, then `docker compose up -d --build bot`. This deliberately narrows the README's full-stack `up -d --build`: there's no `depends_on`, and `llm` is a prebuilt image, so only the bot is rebuilt and recreated.
   3. No `npm run deploy` is needed, since there are no command definition changes.
   4. Check that `docker compose ps` shows the `llm` uptime unchanged and the bot logs `[Chat] Enabled`.
   5. The restart clears in-memory history and gate state (accepted).
   - **Rollback** (if the live test fails):
     1. `docker tag musicbot2:pre-mention musicbot2:local && docker compose up -d --no-build bot`.
     2. Re-extract `aa68e96` to restore the files (`git archive aa68e96 | ssh … tar -x`), then `rm -f chat/mention.js chat/respond.js chat/run.js`, since `tar` doesn't delete files.
8. Live verification with the user.

## 8. Test matrix (red → green)
- **mention:**
  - `<@bot> hi`: trigger.
  - `<@!bot>` form: trigger.
  - Bot role `<@&role>`: trigger.
  - Only `@everyone`: no trigger.
  - Another role: no trigger.
  - Mention only on a `>` line: no trigger.
  - Mention inside a `>>>` block: no trigger.
  - Bot author: no trigger.
  - Webhook: no trigger.
  - DM: no trigger.
  - System message type: no trigger.
  - Reply to the bot with no `<@bot>` in the content: no trigger.
  - `` `<@bot>` `` inline code: no trigger.
  - Mention inside a fenced block: no trigger.
  - `>5 <@bot>`: trigger (not a quote).
  - `>>> x\n<@bot>`: no trigger (the block runs to the end).
  - `> quote\n<@bot> hi`: trigger.
  - Missing `botRoleId`: the role trigger is off, the user trigger still works.
- **extractPrompt:**
  - Strips the bot mention.
  - Drops quoted lines.
  - Code blocks become `[code]`.
  - `<@id>` becomes `@Name`.
  - Exactly 500 characters is unchanged; 501 characters becomes 499 + "…".
  - Mention-only gives `''`.
- **run:**
  - Success appends and returns the answer.
  - Empty answer: not appended.
  - Timeout and unavailable: friendly content, not appended.
  - Unknown error is rethrown.
  - The signal is created at job start, so queued time is excluded.
  - The log line contains no content.
- **respond:**
  - Disabled: no calls.
  - Missing Send permission: no reply, one log line.
  - Cooldown: 🧊 once, then no second 🧊 within the window.
  - Busy reactions are also deduped per user.
  - The dedupe map is pruned.
  - `permissionsFor` returning null: silent, with a log line.
  - Throwing between admit and run: the ticket is cancelled and the queue place freed.
  - A mention admit then a `/chat` admit for the same user: `/chat` gets the ephemeral cooldown.
  - Busy: ⏳.
  - AddReactions missing: no react call.
  - Typing sent at 0 s and again at 8 s, and cleared after.
  - Success: reply with `allowedMentions {parse: [], repliedUser: false}` and `failIfNotExists: false`.
  - Offline: friendly reply.
  - A reply that throws is logged by code only.
  - A /chat admit followed by a mention admit returns cooldown (shared gate).
- **The 157 existing tests** stay green, and the `/chat` tests prove the refactor.

## 9. Acceptance / DoD
- [ ] New tests red-first; full suite green.
- [ ] Live:
  - `@musicbot02 hola` gets a threaded reply that pings no one.
  - Mixing `/chat` and `@` in one channel shares memory.
  - A second @ within 20 s gets 🧊.
  - `> @musicbot02 …` quoted gets no reply.
  - `@everyone` alone gets no reply.
  - The bot's role from autocomplete triggers it.
  - Music unaffected.
- [ ] `origin/main` == HEAD verified. The deployed files' hashes match. Only the bot was recreated.
- [ ] Docs updated.

## 10. Open questions
None. Deferred: `LLM_MENTION_CHANNEL_IDS`, the reply-without-@ trigger (declined).

## 11. Review record
- **Blue-team (2 Sonnet lenses: correctness, scope/deploy):** both go-with-changes. Folded in:
  - Shared code/quote stripping, so a mention inside code doesn't trigger.
  - Discord-accurate quote rules.
  - Ticket cancel between admit and run.
  - Deduped, pruned reaction map.
  - Null-safe `permissionsFor`.
  - Typing cleared before the reply.
  - The fake-message helper and `nameOf` source.
  - Rollback commands, bot-only rebuild, and the llm-uptime check.
  - Log rate-limiting.
  - Doc placement.
- **Gemini 3.8 Flash (medium) cross-model review: ran (rc=0).** It reviewed the pre-blue-team draft.
  - #1 (`botRoleId` undeclared) and #3 (`me` undeclared): already fixed by blue-team.
  - #2 (return after refusal), #4 (pass `nameOf`), #5 (keep and pass the ticket): folded into §5.3.
