// chat/run.js
//
// The generation step shared by /chat and @mentions: run one admitted ticket
// against the model, keep the channel history, log one [Chat] line. Callers
// own admission (chat/gate.js) and presenting the result.
//
// Returns `{ok: true, answer}` (answer may be '' — the caller shows
// EMPTY_REPLY) or `{ok: false, content}` with the friendly text for a timeout
// or an unreachable model. Anything else is a bug and is rethrown.
//
// Privacy: the log line carries channel id, duration, token counts and error
// class only — never the message, the history or the model output.

const { MESSAGES } = require('./format.js');
const { ChatTimeoutError, ChatUnavailableError } = require('./provider.js');

/**
 * @param {{chat: {config: object, history: object, provider: object},
 *          ticket: {run: (fn: () => Promise<any>) => Promise<any>},
 *          channelId: string, name: string, message: string}} options
 * @returns {Promise<{ok: true, answer: string} | {ok: false, content: string}>}
 */
async function generateReply({ chat, ticket, channelId, name, message }) {
  const { config, history, provider } = chat;
  const started = Date.now();

  try {
    const { text, finishReason, usage } = await ticket.run(() => provider.complete({
      // Built at job start, so it includes exchanges that finished while
      // this one waited in the queue.
      messages: history.build(channelId, {
        systemPrompt: config.systemPrompt,
        name,
        message,
        budgetChars: config.historyChars,
      }),
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      // Created INSIDE the job: time spent queued must not eat the timeout.
      signal: AbortSignal.timeout(config.timeoutMs),
    }));

    const answer = text.trim();
    if (answer) history.append(channelId, { name, user: message, assistant: answer });

    console.log(
      `[Chat] Reply in ${channelId} after ${Date.now() - started} ms ` +
      `(prompt ${usage?.promptTokens ?? '?'} tok, completion ${usage?.completionTokens ?? '?'} tok, ` +
      `finish ${finishReason ?? '?'}${answer ? '' : ', empty'})`,
    );
    return { ok: true, answer };
  } catch (error) {
    let content;
    if (error instanceof ChatTimeoutError) {
      content = MESSAGES.timeout;
    } else if (error instanceof ChatUnavailableError) {
      content = MESSAGES.offline;
    } else {
      throw error;
    }
    console.error(`[Chat] ${error.name} in ${channelId} after ${Date.now() - started} ms: ${error.message}`);
    return { ok: false, content };
  }
}

module.exports = { generateReply };
