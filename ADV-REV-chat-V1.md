# ADV-REV-chat-V1 — `/chat` user story (as first presented, 2026-11-10)

**As a** server member, **I want** to type `/chat <message>` and get a reply from a local AI with a playful music-bot persona, **so that** the bot is fun to talk to without any paid or cloud service.

## ☀️ Happy path
1. A user types `/chat message:"recomiéndame algo para estudiar"`.
2. The bot acknowledges within 3 seconds and shows "thinking…".
3. It sends the system prompt, the last ~6 exchanges from this channel, and the new message to `LLM_BASE_URL`.
4. About 5–20 seconds later the reply appears publicly with the question quoted, in the user's language, in 1–3 sentences.
5. Music keeps playing throughout, because the model runs only on CPUs 1 and 3.
6. To change models, you swap the GGUF file or alias in the LLM container's config; the bot needs no rebuild or redeploy.

## 🌧️ Rainy paths
| Case | Behaviour |
|---|---|
| `LLM_BASE_URL` not set | A private (ephemeral) reply says "Chat isn't set up on this bot." |
| LLM container down or still loading | The reply becomes "My brain is offline right now, try later." The rest of the bot is unaffected and the error is logged. |
| One request already generating and the queue is full (3 waiting) | A private reply says "I'm busy, try again in a moment." |
| Same user within 20 seconds | A private reply says "Slow down — try again in N s." |
| Generation passes the 90-second limit | The request is cancelled, so the server stops generating, and the reply becomes "That took too long, try something shorter." |
| Model returns nothing or only whitespace | A friendly fallback line is shown. |
| Reply would exceed Discord's 2,000-character limit | It's trimmed with "…". Replies are already capped at about 200 tokens. |
| Reply contains `@everyone`, role or user mentions | It's shown as text and pings nobody (`allowedMentions: { parse: [] }`). |
| Message longer than 500 characters | Discord rejects it before it reaches the bot. |
| Used in DMs | A private reply says "Chat only works in a server." |
| Bot restarts | Channel history is lost; this is accepted. |
| Discord's 15-minute reply window | The queue limit and timeout keep every request well inside it. |
| History grows past the budget | The oldest exchanges are dropped first; the system prompt is always kept. |

## Assumptions
- Commands typed in DMs are rejected, as `/play` does.
- History is a combined thread per channel, so different users share one conversation.
- The bot never runs tools or commands from model output.
