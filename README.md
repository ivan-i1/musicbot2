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
| `LLM_BASE_URL` | *Optional.* OpenAI-compatible API for `/chat`, e.g. `http://llm:8080/v1`. **Empty (the default) disables chat.** The other `LLM_*` knobs are listed, with defaults, in `.env.example`. |

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
| `/chat <message>` | talk to the bot — a small AI on the home server answers publicly, in your language. Up to 500 characters; one reply at a time for the whole server, a 20 s cooldown per person |

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

## Hosting

Runs 24/7 in Docker on the home server (`~/services/musicbot2`), from `Dockerfile` + `compose.yml`.

Deploy / update from a checkout on your Mac:

```bash
git archive HEAD | ssh escalenus@escalenusserver 'mkdir -p ~/services/musicbot2 && tar -x -C ~/services/musicbot2'
scp .env escalenus@escalenusserver:~/services/musicbot2/.env   # first time, or when it changes
ssh escalenus@escalenusserver 'cd ~/services/musicbot2 && chmod 600 .env && docker compose up -d --build'
```

Logs: `ssh escalenus@escalenusserver 'cd ~/services/musicbot2 && docker compose logs -f --tail 100'`

Only one instance may run per bot token — stop any local `npm start` before deploying.
`data/mailbox.json` lives in the `musicbot2_data` volume. To use local files, set `MUSIC_DIR=/music`
in the server's `.env` and uncomment the `/music` mount in `compose.yml`.

### Chat (local LLM)

`/chat` is answered by a small open-weight model served by `llama-server` in
the `llm` container, pinned to CPUs 1 and 3 so it never competes with ffmpeg on
core 0. It publishes no ports — the bot reaches it at `http://llm:8080/v1` on
the compose network — and the bot does not depend on it: with `llm` down,
`/chat` answers "brain offline" and everything else carries on. (`health-push`
*will* page about the stopped container. To turn chat off, unset
`LLM_BASE_URL` instead of stopping `llm`.)

**Model files.** These are not in git and not in the image. Put them in
`~/services/musicbot2/models/` **before** the first `docker compose up` —
otherwise Docker creates an empty, root-owned `models/` and `llm`
crash-loops. Keep the upstream file names and check the hashes:

| file | sha256 |
|---|---|
| `Qwen_Qwen3.5-2B-Q4_K_M.gguf` (default) | `57a1085840f497d764a7fc5d346922dbde961efb54cc792ea81d694fd846a1d8` |
| `LFM2.5-1.2B-Instruct-Q4_K_M.gguf` (faster, lighter) | `b1b3de114215d9507409a662a501a631095a479a419584e8a2ded6304b19b4f5` |

```bash
ssh escalenus@escalenusserver 'cd ~/services/musicbot2/models && sha256sum *.gguf'
```

Then add `LLM_BASE_URL=http://llm:8080/v1` to the server's `.env`, bring
everything up, and register the new command once from your Mac with
`npm run deploy`.

**Swapping the model** needs no bot rebuild. Edit the `-m` path in the `llm`
service's `command:` in `compose.yml` (keep `--alias chat`), then:

```bash
ssh escalenus@escalenusserver 'cd ~/services/musicbot2 && docker compose up -d llm'
```

A different runtime altogether (Ollama, a hosted API) is `.env` only:
`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`.

**After any `.env` change**, recreate the bot. `docker compose restart` does
not re-read `env_file`:

```bash
ssh escalenus@escalenusserver 'cd ~/services/musicbot2 && docker compose up -d --force-recreate bot'
```

**Rollback.** Before the first chat deploy, take the undo bundle on the
server: `tar czf ~/services/musicbot2-pre-chat.tgz --exclude=models -C ~/services musicbot2`,
`docker tag musicbot2:local musicbot2:pre-chat`, and `cp .env .env.bak-pre-chat`. To undo:

1. Remove `LLM_BASE_URL` from the server's `.env`.
2. `docker compose rm -sf llm`
3. Restore the tarball (or `rm -rf chat commands/chat.js` and delete the `llm` service from `compose.yml`).
4. `docker tag musicbot2:pre-chat musicbot2:local && docker compose up -d --force-recreate bot`
5. From a checkout of `537bd8b`, run `npm run deploy` to unregister `/chat`.
