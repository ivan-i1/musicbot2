# musicbot2

A Discord bot built on [discord.js](https://discord.js.org) v14, running on Node 20+.

Plays local audio files and direct http(s) audio links in a voice channel. No
YouTube scraping, no extra services, no native modules to compile — see
[CLAUDE.md](CLAUDE.md) for the architecture and why it is built this way.

## Setup

```bash
npm install
cp .env.example .env      # then fill in the three values
npm run deploy            # register slash commands with your test guild
npm start
```

### Environment

Create `.env` (it is gitignored — never commit it):

| key | where to find it |
|---|---|
| `DISCORD_TOKEN` | Developer Portal → your app → Bot → Reset Token |
| `CLIENT_ID` | Developer Portal → your app → General Information → Application ID |
| `GUILD_ID` | Right-click your server in Discord → Copy Server ID (needs Developer Mode) |
| `TRACKED_CHANNEL_IDS` | *Optional.* Comma-separated channel IDs to log message stats for. **Empty (the default) tracks nothing.** |
| `MUSIC_DIR` | *Optional.* Directory `/play` may read local files from. Empty = http(s) links only. |

### Privileged intents

In the Developer Portal, under **Bot → Privileged Gateway Intents**, enable
all three of **Message Content Intent**, **Server Members Intent**, and
**Presence Intent**. The bot requests all three and will fail to log in
without them. Presence is what lets `/mailbox` know when someone comes online.

## Commands

| command | what it does |
|---|---|
| `/ping` | replies `Pong!` |
| `/bola8` | magic-8-ball; answers `SI` or `NO` |
| `/mailbox <person> <message>` | DMs the person if they are online, otherwise queues it and delivers when they next come online |
| `/test <input>` | scratch command — currently a stub |
| `/play <track>` | play a file from `MUSIC_DIR`, or an http(s) audio link |
| `/skip` | skip the current track |
| `/stop` | stop, clear the queue, leave the channel |
| `/queue` | show what is playing and what is next |
| `/nowplaying` | show the current track |

## Development

```bash
npm start          # run the bot
npm run deploy     # re-register slash commands (REQUIRED after editing any command's `data`)
npm test           # run the test suite
npm run test:watch # re-run on change
```

**The most common gotcha:** editing a command's `execute` only needs a restart,
but editing its **`data`** — name, description, options — does nothing until you
re-run `npm run deploy`. Discord stores the command definition on its side.

Tests use the built-in Node test runner (`node:test`); there are no test
dependencies to install.

## Music

`/play` takes either a file name relative to `MUSIC_DIR`, or a direct http(s)
audio URL. It does **not** search YouTube — see CLAUDE.md for why that was
ruled out.

`MUSIC_DIR` is a hard boundary, not a default: `../`, absolute paths outside
it, symlinks pointing out of it, and non-http(s) schemes such as `file://` are
all refused. Without that, anyone able to type a slash command could stream
arbitrary files off the host into a voice channel.

Audio is transcoded by the bundled `ffmpeg-static` build, which encodes Opus
directly. There is deliberately **no** `@discordjs/opus` — it has no prebuilt
binary for Node 26 and would fall back to a source compile that fails on a
bare host.
