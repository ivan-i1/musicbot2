# ADV-REV-chat-V2 — /doubt verdicts on the `/chat` story (2026-11-10)

Input: `ADV-REV-chat-V1.md`. Research: musicbot2 code at `537bd8b`, read-only probes of the home server, and llama.cpp source at tag b12199 (commit 372dc5c).

## 1. Verdict table (refutations first)

| # | Claim (V1) | Verdict | Evidence |
|---|---|---|---|
| 1 | Heat alerts happened in the pinned/music config *(stated by the operator, carried in the brief)* | **REFUTED** | `~/scripts/health-push` (cron, every minute) alerts at coretemp ≥ 90 °C. Uptime Kuma logged its only 3 warnings for monitor "MacBook power & temp" at 2026-11-09 11:13, 11:15 and 11:19, which is during the *unpinned* benchmark runs (101–104 °C, `~/llm-test/results/thermal.log`). The 2026-11-10 pinned music test peaked at 87 °C, with no Kuma entries in that window. |
| 2 | Server-side `--predict` caps reply length (unstated assumption) | **REFUTED** | A client's `max_tokens` replaces it; there is no min(). b12199 `tools/server/server-context.cpp:2099` and `server-schema.cpp:46-49`. **The bot must send `max_tokens` itself.** |
| 3 | Replies take ~5–20 s | **CORRECTED** | True only while the single slot still holds *this* channel's conversation; measured cached turns took 6–19 s. With `--cache-ram 0`, switching channels reprocesses the full history: ~850 tokens at 22–24 tok/s pinned prompt speed ≈ 35–40 s, plus up to 200 tokens at 8 tok/s ≈ 25 s, so **~60 s**. `--cache-ram N>0` saves and restores whole per-conversation states (`server-context.cpp:1862-1900`, `server-task.cpp:1838-1919`), with no architecture restriction. |
| 4 | A per-user 20 s cooldown limits heat | **CORRECTED** | It only limits a single user. A few users taking turns can keep the core at 100% indefinitely, which is the 10-minute test case (87 °C steady, 3 °C below the alert line). |
| 5 | If llm is down, "the rest of the bot is unaffected" | **CORRECTED** | The bot is unaffected, but `health-push` raises CONTAINER-DOWN for any compose container that isn't running. A stopped or crashed llm container will page the operator. Disable chat by unsetting the env var, not by stopping the container. |
| 6 | Model swap needs no bot rebuild | **CONFIRMED, with steps** | Edit the llm `command:` and run `docker compose up -d llm`. The server copy is a `git archive` extract (`README.md:87-93`) with no `.git`. The first rollout also needs `npm run deploy` (CLAUDE.md "Two-step deploy"). |
| 7 | 90 s abort stops server generation | **CONFIRMED** | Non-streaming requests poll `is_connection_closed` every second (`server-context.cpp:5427`, `server-http.cpp:737`, `server-queue.cpp:553-557`), and cancel tasks jump the queue (`server-queue.cpp:603-623`). During prompt processing it stops at the next batch boundary. #24496 was proxy-mode only. |
| 8 | `allowedMentions` stops pings on the edited reply | **CONFIRMED** | `editReply` → `webhook.editMessage` (`discord.js/src/structures/interfaces/InteractionResponses.js:245-247`) → `MessagePayload.js:177-180,266`. This also covers the quoted question. |
| 9 | Discord enforces the 500-character input limit | **CONFIRMED** | `setMaxLength` (`@discordjs/builders/dist/index.js:2121`). |
| 10 | Ack within 3 s | **CONFIRMED** | The `deferReply` pattern in `commands/play.js:60`. |
| 11 | 15-minute token is safe | **CONFIRMED** | 1 running + 3 queued × 90 s = 6 min maximum. |
| 12 | History is lost on restart | **CONFIRMED** | In memory only; the only persistence is `data/mailbox.json` (`index.js:43`). |
| 13 | DMs rejected | **CONFIRMED** | The `commands/play.js:17` pattern. |
| 14 | "~6 exchanges" of history | **UNVERIFIABLE as stated** | Exchange size varies, so use a character budget. Tied to #3. |

## 2. What changes the shape of the plan
- **Use `--cache-ram 256` instead of 0**, so replies stay at about 5–20 s across channels (#3).
- **The bot owns the reply cap:** send `max_tokens` on every request (#2).
- **Heat is a sustained-duty problem**, so a global limit is needed, not only a per-user one (#4).

## 3. Additions (unstated, load-bearing)
- `.dockerignore` and `.gitignore` must list `models/`, or every build sends 1.4 GB+ of context (`.dockerignore` currently has no such line).
- In shared channel history, each user turn is prefixed with the speaker's display name.
- There is one llama slot for all guilds and channels, so the queue is global.
- Pin `ghcr.io/ggml-org/llama.cpp:server-b12199` (server-only image). It runs as root by default, so set `user:`.
- The cooldown starts only on an accepted request.
- No ports are published. The bot reaches `http://llm:8080` on the compose default network.

## 4. Dark areas
- **Summer heat margin:** 87 °C was measured at November room temperature. Only a warm-day test settles it.
- **Kuma warning type:** the 11-09 warnings read "No heartbeat in the time window", not a down push. It's unclear whether the cron push stalled under all-core load. Settling it needs the Kuma monitor history or a load test with push logging.
- **`--cache-ram 256` capacity:** unknown. Measure per-conversation state size after deploy (`--metrics`).
- **Persona quality over long threads:** only one 5-turn sample was judged.

## 5. Decisions (operator) — taken 2026-11-10
- **D1 Global heat guard:** a global gap between generations (5 s). Rejected: none; pause-when-hot.
- **D2 Prompt cache:** `--cache-ram 256`.
- **D3 llm-down paging:** keep the CONTAINER-DOWN alert.

## 6. Tradeoffs
- **`--cache-ram 256`:** buys fast cross-channel replies; costs up to 256 MiB of RAM.
- **Global gap:** buys a lower sustained duty and temperature; costs up to 5 s of extra wait per queued request.

## 7. Questions for the next dump
None open. #1–#4 (D1–D3, story V2) were answered by the operator 2026-11-10. The story V2 is in `LOCAL_LLM_CHAT_PLAN.md` §4.
