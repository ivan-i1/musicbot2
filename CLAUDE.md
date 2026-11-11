# CLAUDE.md — musicbot2

A Discord bot built on **discord.js v14** (`14.27.0`) running on **Node v26**.

Plays **local files and direct http(s) audio links** in a voice channel.
There is deliberately no YouTube support — see *Music* below.

## Commands

```bash
npm start              # run the bot (node index.js)
npm run deploy         # register slash commands with Discord
npm test               # node:test suite (built-in runner, no test deps)
npm run test:watch     # same, in watch mode
```

## Required environment

`.env` is **gitignored and must never be committed**. Keys:

| key | needed by | purpose |
|---|---|---|
| `DISCORD_TOKEN` | `index.js`, `deploy-commands.js` | bot auth |
| `CLIENT_ID` | `deploy-commands.js` | application ID for command registration |
| `GUILD_ID` | `deploy-commands.js` | test server for guild-scoped registration |
| `TRACKED_CHANNEL_IDS` | `index.js` | *optional*, comma-separated. Empty = track nothing |
| `MUSIC_DIR` | `commands/play.js` | *optional*, directory `/play` may read. Empty = URLs only |
| `LLM_BASE_URL` | `chat/config.js` | *optional*, e.g. `http://llm:8080/v1`. Empty = `/chat` disabled |
| `LLM_MODEL` | `chat/config.js` | *optional*, default `chat` (llama-server `--alias`) |
| `LLM_API_KEY` | `chat/config.js` | *optional*, sent as `Authorization: Bearer` only if set |
| `LLM_MAX_TOKENS` | `chat/config.js` | *optional*, default 200. Sent on every request — server `--predict` does not cap it |
| `LLM_TIMEOUT_MS` | `chat/config.js` | *optional*, default 120000, counted from job start |
| `LLM_QUEUE_MAX` | `chat/config.js` | *optional*, default 3 waiting (plus 1 running) |
| `LLM_COOLDOWN_MS` | `chat/config.js` | *optional*, default 20000, per user |
| `LLM_GAP_MS` | `chat/config.js` | *optional*, default 5000, global gap between generations |
| `LLM_HISTORY_CHARS` | `chat/config.js` | *optional*, default 2400, per-channel history budget |
| `LLM_TEMPERATURE` | `chat/config.js` | *optional*, default 0.7 |
| `LLM_SYSTEM_PROMPT` | `chat/config.js` | *optional*, replaces the built-in persona |

Invalid `LLM_*` numbers fall back to the default with a `[Chat]` warning.

## Architecture

**Command auto-loading.** `index.js` reads every `.js` in `commands/` and
registers any module exporting BOTH `data` (a `SlashCommandBuilder`) and
`execute(interaction)`. A file missing either is skipped with a warning
rather than crashing — so a broken command fails silently at load. Same
contract is re-read independently by `deploy-commands.js`.

**Two-step deploy.** Editing a command's `execute` takes effect on restart.
Editing its `data` — name, description, options — does **nothing** until you
re-run `npm run deploy`. Discord stores the command *definition* server-side.
This is the single most common "my change did nothing" cause in this repo.

**Guild vs global.** `deploy-commands.js:39` registers to `GUILD_ID` only
(instant). The global route is commented out at `:42` and takes up to an hour
to propagate. Keep using guild scope for development.

**Mailbox.** `/mailbox` is two halves. The command (`commands/mailbox.js`)
delivers immediately if the target is online, and otherwise queues to
`client.mailbox`. The `presenceUpdate` listener in `index.js` drains that
queue on the offline→online *edge*. `mailbox.js` holds the store plus the two
presence predicates; it is file-backed at `data/mailbox.json` (gitignored)
because queued mail must outlive a restart. `takeFor()` persists the removal
*before* the caller delivers — a crash mid-send loses a message rather than
re-delivering it forever.

**Chat.** `/chat` talks to a small local model through the OpenAI-compatible
`/chat/completions` API at `LLM_BASE_URL` — on the server, the `llm` compose
service (llama-server, pinned to CPUs 1,3). Swapping the model is a compose
edit; swapping the runtime is `.env` only. `index.js` hangs `client.chat`
(`chat/index.js`: config, history, gate, provider) off the client;
`commands/chat.js` only sequences them. Load-bearing details:
- **One llama slot for every guild**, so `chat/gate.js` is one global FIFO:
  1 running + `LLM_QUEUE_MAX` waiting, a per-user cooldown stamped only on an
  accepted request, and a gap of `LLM_GAP_MS` after each generation *ends*
  (the heat guard — a few users taking turns could otherwise hold the core at
  100%). `admit()` reserves **synchronously**, so two users racing for the
  last place while `deferReply` is in flight cannot both get it; the ticket is
  then `run()` or `cancel()`ed.
- **The timeout signal is created inside the queued job**, so queue wait never
  eats into `LLM_TIMEOUT_MS`. Aborting the request makes llama-server stop
  generating.
- `chat/provider.js` has one try/catch around `fetch` *and* body parsing, so a
  timeout mid-body is still a timeout. Everything else is
  `ChatUnavailableError` → "brain offline".
- **Every `editReply` sets `allowedMentions: { parse: [] }`**; the model can
  write `@everyone` and ping nobody. The quoted name and question go through
  `escapeMarkdown` **plus** escaping of `[ ] < >`, because `escapeMarkdown`
  leaves `[x](y)` masked links intact.
- **Never log message content** — not user text, history or model output, and
  not a `DiscordAPIError` object (it carries the request body). `[Chat]` lines
  carry channel id, duration, token counts and error class only.
- History is per channel id (threads get their own), in memory, budgeted by
  characters, assistant turns capped at 600 characters. Failed or empty
  exchanges are not stored.
- **@mentions use the same pipeline.** A second `messageCreate` listener in
  `index.js` asks `chat/mention.js` (pure) whether the bot user `<@id>`/`<@!id>`
  or its managed role `<@&id>` appears in the *raw content* after
  `stripQuotesAndCode` — code first, then `>>> ` to the end, then `^\s*>\s`
  lines — so a quoted or code-fenced @bot never triggers (`mentions.has()`
  would, since quoted mentions still land in `mentions`). Bots, webhooks, DMs,
  system messages and edits are ignored. `chat/respond.js` then shares
  `/chat`'s gate (cooldown, queue, heat gap) and channel history via
  `chat/run.js` (`generateReply`, the generation step both paths call).
  Refusals are a 🧊/⏳ reaction, at most one per user per cooldown window;
  missing View/Send(InThreads)/Read History is silent with one `[Chat]` line
  per channel per hour; the reply uses `allowedMentions: { parse: [],
  repliedUser: false }` and `failIfNotExists: false`. Same privacy rule: no
  content logged, and no replied-to or older message is ever fetched.

**`utils.js`** holds `sendDmToUser(client, userId, content)`, which swallows
Discord error codes `50007` (DMs closed/blocked) and `10013` (unknown user)
and returns `false` rather than throwing. Callers must check the return value
— several currently do not.

## Privileged intents

`index.js` requests **three privileged intents** — `MessageContent`,
`GuildMembers`, and `GuildPresences`. All three must be toggled on in the
Discord Developer Portal (**Bot → Privileged Gateway Intents**) or the bot
fails to log in. `Guilds` and `GuildMessages` are not privileged.

`GuildPresences` is what makes `/mailbox` deferred: without it no
`presenceUpdate` fires, and queued mail is never delivered.

## Music

**Audio source scope, decided 2026-08-18.** Local files + direct URLs only.
YouTube extraction was investigated and rejected: `@distube/ytdl-core` is
archived and fails live, `play-dl`'s repo is deleted, `youtubei.js` cannot
produce a playable URL under YouTube's SABR rollout, and Lavalink's
`youtube-source` plugin breaks roughly monthly and would add a JVM. This bot
has nothing that can rot.

**No native modules.** `@discordjs/opus` has **no prebuilt binary for Node 26**
— installing it triggers a source compile that fails on any host without a
toolchain. Instead ffmpeg (from `ffmpeg-static`, built `--enable-libopus`)
encodes Opus itself and `@discordjs/voice` only demuxes. Likewise no
`sodium`/`tweetnacl`: voice prefers AES-256-GCM via Node's built-in crypto.
Confirm both with `generateDependencyReport()` from `@discordjs/voice`.

**`-reconnect` is an HTTP-protocol option.** Passing it for a file input makes
ffmpeg exit with `Option reconnect not found` before producing a byte —
silent, since the failure is in a spawned process. `buildFfmpegArgs()` adds it
only for `kind: 'url'`, and a test asserts that.

**`music/library.js` is a security boundary.** ffmpeg opens `file://`,
`concat:`, `ftp://` and traversal paths just as happily as a music file, so
`/play` input is confined to `MUSIC_DIR`: containment is checked *after*
`realpath` (or a symlink inside the library escapes it), and only `http:` and
`https:` schemes pass. Do not relax this to "make paths more convenient".

**Testable vs not.** `music/queue.js` (ordering) and `music/library.js`
(resolution) are pure and fully unit-tested. `music/player.js` needs a live
gateway — but its ffmpeg pipeline does not, so `test/player.test.js` runs real
ffmpeg over a generated tone and asserts the output is genuine Ogg Opus. That
is the gate that catches "connects but no sound".

## Conventions

- **Testing:** `node:test` + `node:assert/strict`, files in `test/**/*.test.js`.
  No jest/vitest — the built-in runner keeps test deps at zero; the repo has
  four runtime deps (`@discordjs/voice`, `discord.js`, `dotenv`,
  `ffmpeg-static`). Network code uses Node's global `fetch`, not a client lib.
  Shared fakes live in `test/helpers/` (not `*.test.js`, or the glob runs them).
- **Pure logic goes in a testable module**, not inline in an event handler.
  Anything reachable only through a live `Client` cannot be unit-tested, so
  keep handlers thin and put decisions in plain functions.
- Discord.js deprecations are enforced by tests where practical: prefer
  `flags: MessageFlags.Ephemeral` over `ephemeral: true` (still deprecated in 14.27.0), and `clientReady`
  over the deprecated `ready` event.
