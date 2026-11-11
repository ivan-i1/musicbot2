# LOCAL_LLM_CHAT_PLAN — `/chat` on a local model for musicbot2

> Task: `MUSICBOT2 MAIN local-llm-chat` (estimate 4 h). /doubt record: `ADV-REV-chat-V1.md` (story) → `ADV-REV-chat-V2.md` (verdicts).
## 1. Goal
Let server members talk to the bot with `/chat`. Replies come from a small open-weight model served by `llama-server`
in its own container on the home server. The setup is free and local, and the model can be swapped by changing config
only: the bot speaks the OpenAI-compatible chat API to a URL set in env.

## 2. Status (2026-11-10)
- Research and live tests are done. Results are in this conversation and `~/llm-test/results` on the server.
- Measured, pinned to CPUs 1,3 with 2 threads:
  - Qwen3.5-2B Q4_K_M: 8.2 tok/s generation, 24 tok/s prompt, 883 MiB RSS.
  - LFM2.5-1.2B: 15.3 and 35 tok/s, 572 MiB.
  - 10 minutes of nonstop load during music: 87 °C peak, no throttling, music unaffected (heard by the user).
- The heat alert line is 90 °C (`~/scripts/health-push`). The alerts that fired came from the *unpinned* benchmark, which reached 104 °C.
- Decisions:
  - URL in the bot (no separate proxy); `/chat` first.
  - History per channel; replies public; anyone, in any channel.
  - Per-user cooldown, a global gap between replies and a reply cap; friendly persona in the user's language.
  - `--cache-ram 256`; keep paging when the llm container is down.
- **§9 steps 1–5 implemented (2026-11-10)** on `feat/chat-llm` (worktree `.claude/worktrees/chat-llm`, 6 commits on `537bd8b`, not pushed):
  - `chat/{config,format,history,gate,provider,index}.js`, `commands/chat.js`, `index.js` wiring; every module red → green.
  - Tests 77 → 157, all green. New: `test/chat-{config,format,history,gate,provider,index,command}.test.js` + `test/helpers/fakeInteraction.js`.
  - `compose.yml` `llm` service as §7.8 (validated with `docker compose config -q` on a temp copy, since no `.env` exists in the worktree). `models/` ignored in git + Docker context, `.claude/` in git.
  - `.env.example`, `CLAUDE.md` (env table, Chat paragraph, 4 runtime deps), `README.md` (`/chat` row, Hosting → Chat: model sha256, swap, `--force-recreate`, rollback).
  - Deviations: provider also returns `usage` (for the `[Chat]` token-count log line); the README undo-bundle `tar` puts `--exclude=models` **before** the operand (GNU tar treats it as positional, so §9 step 7.2's order would not exclude).
  - Step 1's `.git/info/exclude` line was skipped: that file is shared with the primary checkout, and the `.gitignore` line ships in the branch.
- **Not done:** §9 step 6 (ship) onward — no push, no deploy, no `npm run deploy`, nothing live-verified (DoD #3 is still open).

## 3. Current state (code-checked, `musicbot2@537bd8b`)
- **Commands are auto-loaded** from `commands/*.js` (`index.js:52-57`, `commandLoader.js:16-50`). Registering a new definition needs `npm run deploy` (`deploy-commands.js:29-31`, guild scope).
- **Shared services hang off `client`:** `client.mailbox` (`index.js:43`) and `client.music` (`index.js:47`). Env is read in `index.js` via dotenv (`index.js:12-19`).
- **The deferred-reply pattern** is in `commands/play.js:60`, with a guild-only check at `play.js:17`. Command errors go to `respondWithError` (`utils.js:59-73`, called at `index.js:91-96`), which handles already-deferred interactions.
- **Mention handling:** `editReply` → `webhook.editMessage` (`node_modules/discord.js/src/structures/interfaces/InteractionResponses.js:245-247`), and `allowedMentions` is honoured by `MessagePayload.js:177-180,266`. `setMaxLength` exists on string options (`@discordjs/builders/dist/index.js:2121`).
- **Tests** use `node:test` + `assert/strict` with hand-written fakes (`test/utils.test.js:7-17`). The suite currently has 77 passing tests. The repo keeps 4 runtime deps and adds none for tests (`CLAUDE.md` Conventions); Node ≥20 provides global `fetch`/`AbortSignal.timeout` (`package.json` engines).
- **Deployment:**
  - `compose.yml` has one `bot` service: no ports, default network, `mem_limit: 512m`.
  - The server copy `~/services/musicbot2` is a `git archive` extract (README "Hosting", lines 87-93) with no `.git`.
  - `.dockerignore` and `.gitignore` have no `models/` entry; `.gitignore` covers `claude/` but not `.claude/`.
- **Server:** uid 1000. `health-push` runs every minute and alerts on any compose container that isn't running, on ≥90 °C, or on battery power.
- **Image:** `ghcr.io/ggml-org/llama.cpp:server-b12199` exists (amd64 manifest found). The `full` image ships `/usr/bin/curl`; the server image is presumed to as well, but that is unverified (it's the first deploy pre-check in §9 step 7).

## 4. User story (V2, confirmed)
As a server member, I want `/chat <message>` to get a reply from a local AI with a playful music-bot persona, so that
the bot is fun to talk to without paid or cloud services.

☀️ The user types `/chat message:"…"` (max 500 characters).
1. The bot checks the guild, config, cooldown and queue, then `deferReply`.
2. Messages are built as: system prompt, then this channel's history within a character budget (each user turn prefixed with the speaker's display name), then the new message.
3. POST to `${LLM_BASE_URL}/chat/completions` with `max_tokens: 200`.
4. `editReply` with the question quoted and the answer, `allowedMentions: {parse: []}`, trimmed to 2000 characters.
5. The exchange is appended to the channel's history.

The model can be swapped through llm container config alone.

🌧️
| Case | Behaviour |
|---|---|
| `LLM_BASE_URL` unset | Ephemeral "Chat isn't set up on this bot." |
| DM | Ephemeral "Chat only works in a server." |
| Message is only whitespace | Ephemeral "Say something first." |
| Same user within 20 s of their last *accepted* request | Ephemeral "Slow down — try again in N s." |
| 1 running + 3 waiting | Ephemeral "I'm busy, try again in a moment." The cooldown is not consumed. |
| Global gap | The next generation starts ≥5 s after the previous one ended. Waiting stays inside the queue. |
| Connection refused, DNS failure, 5xx, or 503 while loading | Edit to "My brain is offline right now — try again later." Logged as `[Chat] …`. |
| More than 120 s of generation (`AbortSignal.timeout`, created when the job starts) | The request is aborted (the server stops within about 1 s) and the reply is edited to "That took too long — try something shorter." |
| Empty or whitespace output | "🤔 I've got nothing — ask me something else." |
| Output over 2000 characters | Trimmed with "…". |
| Unexpected throw | `respondWithError` (follows up, since the interaction is deferred). |
| Restart | History is gone (accepted). |
| History over budget | Oldest exchanges are dropped; the system prompt is always kept. |

Failed or empty exchanges are **not** added to history.

## 5. Target architecture
```
Discord ── /chat ──> bot (commands/chat.js, thin)
                      └─ client.chat = { config, history, gate, provider }   (chat/*.js, pure + tested)
                           provider.complete() ── HTTP ──> llm:8080 (llama-server, compose default net, no ports)
                                                           cpuset 1,3 · threads 2 · parallel 1 · cache-ram 256
                                                           model file: ~/services/musicbot2/models/*.gguf (ro mount)
```
To swap models, change `-m` in the llm `command:` (keeping `--alias chat`) and run `docker compose up -d llm`. A
different runtime (Ollama, a hosted API) means changing `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY` in `.env` and
restarting the bot.

## 6. Scope
**In:** `/chat` command; `chat/` modules + tests; llm compose service; `.env.example`, `CLAUDE.md` and README docs; deployment and live verification.
**Out:** @mention trigger, streaming edits, persistent history, hosted fallback, tools/function calling, a host-temperature guard, model quality tuning beyond the system prompt, any change to `health-push`.

## 7. Detailed design

### 7.1 Config — `chat/config.js` `parseChatConfig(env)`
| Env | Default | Notes |
|---|---|---|
| `LLM_BASE_URL` | unset → chat disabled | e.g. `http://llm:8080/v1`; trailing `/` stripped |
| `LLM_MODEL` | `chat` | matches `--alias chat` |
| `LLM_API_KEY` | unset | sent as `Authorization: Bearer` only if set |
| `LLM_MAX_TOKENS` | 200 | |
| `LLM_TIMEOUT_MS` | 120000 | a cold ~1000-token prompt + 200 tokens ≈ 66 s; worst case 4 × 125 s ≈ 8.3 min < the 15-minute token |
| `LLM_QUEUE_MAX` | 3 | waiting, excluding the running one |
| `LLM_COOLDOWN_MS` | 20000 | per user |
| `LLM_GAP_MS` | 5000 | global, between generations |
| `LLM_HISTORY_CHARS` | 2400 | history budget, excluding system prompt and new message |
| `LLM_TEMPERATURE` | 0.7 | |
| `LLM_SYSTEM_PROMPT` | built-in persona | see below |

Invalid numbers fall back to the default with a warning. The default persona: *"You are the music bot of this Discord
server: friendly, playful, brief. Reply in the language the user writes in, in 1 to 3 sentences. Messages are prefixed
with the speaker's name. If you don't know something, say so; never invent facts. Never ping or mention people."*

### 7.2 History — `chat/history.js` `ChannelHistory`
- `append(channelId, {name, user, assistant})`.
- `build(channelId, {systemPrompt, name, message, budgetChars})` returns
  `[{role:'system'}, …pairs as {role:'user', content:'<name>: <user>'}/{role:'assistant'}, {role:'user', content:'<name>: <message>'}]`.
- It drops the oldest pairs until the history is within the budget, and keeps at most 20 pairs per channel in memory.

### 7.3 Gate — `chat/gate.js` `ChatGate({queueMax, cooldownMs, gapMs, now, sleep})`
- **`admit(userId)` reserves synchronously**, with no `await` between the check and the reservation. This closes the race where two users are both admitted for the last free place while `deferReply` is pending. It returns one of:
  - `{ok:true, ticket}`, after stamping the user's cooldown and counting the ticket toward the queue;
  - `{ok:false, reason:'cooldown', retryInS}`;
  - `{ok:false, reason:'busy'}`.
- **`ticket.run(fn)`** joins the FIFO. Before starting it waits until `lastEndTs + gapMs`, which is checked at start, so an idle bot never sleeps. It then runs `fn` and always releases in `finally`.
- **`ticket.cancel()`** releases an unused reservation, for example if `deferReply` throws. The cooldown stays stamped.
- `queueMax` counts *waiting* jobs only: 1 running + up to 3 waiting. The clock and sleep are injected for tests.

### 7.4 Provider — `chat/provider.js` `createOpenAIProvider({baseUrl, model, apiKey, fetch = globalThis.fetch})`
- `complete({messages, maxTokens, temperature, signal})` POSTs `{model, messages, max_tokens, temperature}` and returns `{text, finishReason}`. It reads `choices[0].message.content` and ignores `reasoning_content`.
- Errors map to two classes. `fetch` and `res.json()` sit inside one try/catch, because the timeout can fire while the body is being read:
  - `ChatTimeoutError`: `err.name` is `TimeoutError` or `AbortError`, or `signal.aborted`.
  - `ChatUnavailableError`: anything else, i.e. `TypeError('fetch failed')`, a non-2xx response, or a malformed body. Its message carries the status/code only, never the request or response body.
- It never sends the `X-Conversation-Id` header.

### 7.5 Format and sanitize — `chat/format.js`
- **`cleanInput(text)`:** collapse all whitespace and newlines to single spaces, then trim. An empty result is rejected.
- **`cleanName(name)`:** strip control characters, collapse whitespace, cap at 32 characters, fall back to `user`.
- **`formatReply({name, question, answer})`** returns `> **<escName>:** <escQuestion>\n<answer>`:
  - The name and question go through discord.js `escapeMarkdown`, **plus** escaping `[`, `]`, `<` and `>`. Checked 2026-11-10: `escapeMarkdown('[x](y)')` leaves masked links intact. With both, they can't forge bot text or links.
  - The answer is model output and is not escaped, but mentions stay disabled.
  - The result is ≤2000 characters, trimming the answer first.
- **History storage:** the stored assistant text is capped at 600 characters, so a single pair can't exceed the budget.
- **Constants:** `EMPTY_REPLY` and all user-facing strings are exported, so tests can assert them.
- **Privacy:** user messages, history and model output are **never logged**. Only `[Chat]` event lines are written, with channel id, duration, token counts and error class.

### 7.6 Command — `commands/chat.js`
- `SlashCommandBuilder` `chat` with a required string option `message`, `setMaxLength(500)`.
- `execute`, in order:
  1. Guild check.
  2. `client.chat?.config.enabled`.
  3. `cleanInput`; if empty, an ephemeral "Say something first."
  4. `gate.admit`; reject ephemerally if it fails. All rejections use `flags: MessageFlags.Ephemeral`.
  5. `deferReply()`; on throw, `ticket.cancel()` and rethrow.
  6. `ticket.run(() => provider.complete({messages: history.build(...), signal: AbortSignal.timeout(timeoutMs)}))`. **The signal is created inside the job**, so queue wait doesn't consume the timeout.
  7. On success: `history.append`, then `editReply({content: formatReply(...), allowedMentions: {parse: []}})`.
  8. On known errors: `editReply` with the friendly string (also `allowedMentions: {parse: []}`) and `console.error('[Chat] <class>')`.
  9. If `editReply` itself throws (token expired), log it and swallow.
  10. Anything else is rethrown to the `index.js` handler.
- Name: `cleanName(interaction.member?.displayName ?? interaction.user.username)`.
- History is keyed by `interaction.channelId`, so a thread gets its own history.
- **Accepted risk:** a user can still write "Bot: …" inside their message to steer the model. It's a toy bot with no tools and mentions disabled, so the impact is cosmetic.

### 7.7 Wiring — `index.js`
After `client.music`, add `client.chat = createChat(process.env)` (`chat/index.js` assembles config, history, gate and
provider). On `clientReady`, log `[Chat] Enabled → <baseUrl> (model <model>)` or `[Chat] Disabled — set LLM_BASE_URL`.

### 7.8 Compose — `llm` service (bot service unchanged except env)
```yaml
  llm:
    image: ghcr.io/ggml-org/llama.cpp:server-b12199   # digest recorded in README at deploy
    restart: unless-stopped
    init: true
    user: "1000:1000"
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    cpuset: "1,3"          # one physical core; core 0 stays free for ffmpeg + other services
    mem_limit: 2g
    memswap_limit: 2g
    volumes: ["./models:/models:ro"]
    command: >
      -m /models/Qwen_Qwen3.5-2B-Q4_K_M.gguf --alias chat --host 0.0.0.0 --port 8080
      --threads 2 --threads-batch 2 --parallel 1 --poll 0 --ctx-size 4096
      --cache-ram 256 --predict 256 --reasoning off --no-webui --metrics
    healthcheck:
      test: ["CMD", "curl", "-fs", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s
```
- No `ports:`. No `depends_on` from the bot, because the bot must run without the llm.
- **Flags:** every one was verified in b12199's `llama-server --help` on 2026-11-10, and the live tests ran with them.
- **Model filename:** the upstream filename is kept as-is (the sha256 is recorded in the README). LFM uses `LFM2.5-1.2B-Instruct-Q4_K_M.gguf`.
- **Memory:** `mem_limit 2g` vs 883 MiB measured, plus ≤256 MiB cache plus the KV for 4096 tokens. Record peak RSS in the live test.
- The bot `.env` gains `LLM_BASE_URL=http://llm:8080/v1`.
- `models/` is added to `.gitignore` and `.dockerignore`, and `.claude/` to `.gitignore` (worktree convention).

## 8. Code touches
| File | Change |
|---|---|
| `chat/config.js`, `chat/history.js`, `chat/gate.js`, `chat/provider.js`, `chat/format.js`, `chat/index.js` | new |
| `commands/chat.js` | new; pattern from `commands/play.js:16-73` |
| `index.js` | `require('./chat')`; `client.chat` after line 48; ready log at lines 63-75 |
| `test/chat-*.test.js` | new (see §10) |
| `compose.yml` | add `llm` service |
| `.gitignore`, `.dockerignore` | `models/`; `.gitignore` also gets `.claude/` |
| `.env.example`, `CLAUDE.md` (env table, an Architecture "Chat" paragraph, fix the "two runtime deps" wording, which is really 4), `README.md` (Hosting: model files and sha256, swap procedure, `--force-recreate` for `.env` changes, rollback) | docs |

## 9. Implementation order
1. **Worktree:** `git worktree add .claude/worktrees/chat-llm -b feat/chat-llm`. Exclude `.claude/` locally via `.git/info/exclude` now; the `.gitignore` line ships with the feature commit. Then `npm ci` in the worktree.
2. **Pure modules test-first:** config, history, gate, format (red → green each).
3. **Provider test-first:** against a fake `fetch` and a real local `node:http` server (abort and 503 cases).
4. **Command and wiring:** `commands/chat.js` with a fake-interaction test, `index.js`, and the existing commandLoader test still green.
5. **Compose, ignores and docs.** Full suite green.
6. **Ship** (`/ship`) as one squashed commit on main.
7. **Deploy.** Pick a time when no music is playing, because rebuilding the bot drops voice sessions; tell the user first. Steps 1–3 are the undo, done before anything changes (DoD #5).
   1. **Pre-checks:** confirm `curl` is in the server image with `docker run --rm --entrypoint sh ghcr.io/ggml-org/llama.cpp:server-b12199 -c 'command -v curl'`. If it's missing, change the healthcheck before shipping.
   2. **Undo bundle:**
      - `tar czf ~/services/musicbot2-pre-chat.tgz --exclude=models -C ~/services musicbot2` (`--exclude` before the name, or GNU tar ignores it)
      - `docker tag musicbot2:local musicbot2:pre-chat`
      - `cp .env .env.bak-pre-chat`
   3. **Model:** `mkdir -p ~/services/musicbot2/models`, then copy the already-verified `~/llm-test/models/qwen.gguf` (and `lfm.gguf`) under their upstream names and re-check the sha256. This must happen before `up`, or Docker creates an empty, root-owned `./models` and llm crash-loops.
   4. **Code:** from the main checkout, `git archive origin/main | ssh … tar -x -C ~/services/musicbot2` (origin/main, not the local HEAD).
   5. **Env:** append `LLM_BASE_URL=http://llm:8080/v1` to the server `.env`.
   6. **Start:** `docker compose up -d --build`, then wait for llm healthy and the bot's "Logged in" + `[Chat] Enabled` log lines.
   7. **Register:** `npm run deploy` from the main checkout, which has the `.env`.
   - **Rollback:**
     1. Remove `LLM_BASE_URL` from `.env`.
     2. `docker compose rm -sf llm`.
     3. Restore the tarball (or `rm -rf chat commands/chat.js` and strip `llm` from compose).
     4. `docker tag musicbot2:pre-chat musicbot2:local && docker compose up -d --force-recreate bot`.
     5. Run `npm run deploy` from `537bd8b` to unregister `/chat`.
   - `.env`-only changes later need `up -d --force-recreate bot`, because `restart` doesn't re-read `env_file`.
8. **Live verify with the user (DoD #3):**
   - Happy path in Spanish and English, two channels (to exercise cache reuse), cooldown, busy, an `@everyone` prompt, and a multi-line or markdown question.
   - Music playing during chat.
   - Watch `health-push`, temperature, `docker stats llm` peak RSS, and `/metrics` prompt tokens (cache effect).
9. **Clean up** `~/llm-test` and the `full-b12199` image after the user confirms.

## 10. Test matrix (red → green)
- **config:**
  - Defaults.
  - Disabled without a URL.
  - Trailing slash stripped.
  - Bad numbers fall back with a warning.
  - Custom system prompt.
- **history:**
  - Speaker prefix.
  - Oldest dropped beyond the budget.
  - System prompt always first.
  - Channels isolated.
  - 20-pair cap.
  - An empty channel gives just system + user.
- **gate:**
  - Cooldown with `retryInS`.
  - Cooldown starts only on `run`.
  - Busy when queue full.
  - FIFO order.
  - Single flight (never two `fn`s concurrently).
  - Gap enforced between jobs.
  - Release on throw.
- **provider:**
  - Request body shape: `max_tokens` is sent, no conversation header, Bearer only when the key is set.
  - `reasoning_content` ignored.
  - Non-2xx → Unavailable.
  - Connection refused → Unavailable.
  - Abort/timeout → Timeout, against a real slow local server.
  - Malformed JSON → Unavailable.
- **format:**
  - Quote layout.
  - ≤2000 characters, with the answer trimmed first.
  - Empty → `EMPTY_REPLY`.
- **format/sanitize:**
  - Newlines collapsed.
  - Markdown escaped in the name and question.
  - Name capped at 32 characters, with control characters stripped.
  - Whitespace-only input rejected.
  - Stored assistant text capped at 600 characters.
- **gate race:** two synchronous `admit`s when one place is left → one ok, one busy; `cancel` frees the place; the gap is not applied after an idle period.
- **timeout placement:** a queued job still gets its full timeout. The signal is created at job start, tested with a fake slow provider.
- **command (fake interaction):** shared helper `test/helpers/fakeInteraction.js` with `deferReply`, `editReply`, `reply`, `followUp`, `options.getString`, `member`, `user`, `guildId`, `channelId` and `client.chat` (stub provider and gate). Also cover `editReply` throwing (logged and swallowed) and whitespace-only input. Cases:
  - DM rejected.
  - Disabled.
  - Cooldown and busy replies are ephemeral and don't defer.
  - Success → `editReply` with `allowedMentions.parse` empty.
  - Unavailable and timeout → friendly edit.
  - History appended only on success.
- **Existing 77 tests** stay green.
- **Live (not unit-testable):** the §9 step 8 checklist.

## 11. Acceptance / Definition of Done
- [ ] All new tests written red-first, and the full suite is green (77 + new).
- [ ] `/chat` works live in the guild with music playing; no audible stutter (user-confirmed).
- [ ] An `@everyone` prompt pings nobody (live).
- [ ] Stopping llm → "brain offline" reply and a `health-push` page (expected). Restarting it recovers without restarting the bot.
- [ ] Swapping to LFM2.5 is a compose edit plus `docker compose up -d llm` only; `/chat` works after.
- [ ] Peak ≤ 89 °C during a 5-minute chat burst. No `health-push` CPU-HOT.
- [ ] `origin/main` == shipped HEAD (verified by comparison). The server deploy is verified by file hash and container start time.
- [ ] Docs updated: env table, Hosting model download, swap, rollback.

## 12. Open questions / review record
- **Blue-team (3 Sonnet lenses: feasibility, sequencing/deploy, scope):** all go-with-changes, no rework. Folded in:
  - The `admit` race (synchronous reservation).
  - The timeout signal created inside the job, and the timeout raised to 120 s.
  - fetch/body error classification.
  - Input sanitizing and markdown escaping.
  - Logging privacy.
  - `--metrics`.
  - Rollback and the undo bundle, deploy from `origin/main`, model files placed before `up`, the curl pre-check.
  - The shared fake-interaction helper.
  - The Spanish live check.
  - Fixing CLAUDE.md's "two runtime deps".
  - No reviewers disagreed.
- **Cross-model (Gemini 3.8 Flash via `agy`): did NOT happen.**
  - The first run was refused for tool permission in headless mode, with no output.
  - The retry timed out (rc=124).
  - No Gemini review exists for this plan.
- **Not blocking:** Recorded unknowns, from ADV-REV-chat-V2:
- Summer-heat margin.
- `--cache-ram 256` capacity (measure after deploy).
- Persona quality over long threads.
- Whether Kuma's 11-09 "No heartbeat" means the push cron itself stalled under all-core load.

