// chat/provider.js
//
// The only code that talks to the model. It speaks the OpenAI-compatible
// `/chat/completions` API, so llama-server, Ollama or a hosted API are all a
// change of LLM_BASE_URL / LLM_MODEL / LLM_API_KEY — never of code.
//
// Every failure maps to one of two classes the command turns into a friendly
// reply:
//   - ChatTimeoutError     — the caller's signal fired (TimeoutError/AbortError).
//   - ChatUnavailableError — anything else: connection refused, DNS, non-2xx
//     (503 while the model loads), malformed body.
// `fetch` and body parsing share ONE try/catch because the timeout can fire
// while the body is still arriving, not only before the headers.
//
// Privacy: error messages carry a status or error code only — never the
// request (user messages) or the response body (model output).

class ChatTimeoutError extends Error {
  constructor(message = 'LLM request timed out') {
    super(message);
    this.name = 'ChatTimeoutError';
  }
}

class ChatUnavailableError extends Error {
  constructor(message = 'LLM unavailable') {
    super(message);
    this.name = 'ChatUnavailableError';
  }
}

function isAbort(error, signal) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || Boolean(signal?.aborted);
}

/**
 * @param {{baseUrl: string, model: string, apiKey?: string|null, fetch?: typeof globalThis.fetch}} options
 */
function createOpenAIProvider({ baseUrl, model, apiKey = null, fetch = globalThis.fetch }) {
  const url = `${baseUrl}/chat/completions`;

  return {
    /**
     * @param {{messages: {role: string, content: string}[], maxTokens: number,
     *          temperature: number, signal?: AbortSignal}} request
     * @returns {Promise<{text: string, finishReason: string|null, usage: {promptTokens: number|null, completionTokens: number|null}|null}>}
     */
    async complete({ messages, maxTokens, temperature, signal }) {
      // Deliberately no X-Conversation-Id header — a test pins this.
      const headers = { 'content-type': 'application/json' };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;

      let data;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
          signal,
        });
        if (!res.ok) {
          // Drain without reading the body into an error message.
          res.body?.cancel().catch(() => {});
          throw new ChatUnavailableError(`HTTP ${res.status}`);
        }
        data = await res.json();
      } catch (error) {
        if (error instanceof ChatUnavailableError) throw error;
        if (isAbort(error, signal)) throw new ChatTimeoutError();
        const code = error?.cause?.code ?? error?.code ?? error?.name ?? 'unknown';
        throw new ChatUnavailableError(`request failed (${code})`);
      }

      const choice = data?.choices?.[0];
      if (!choice || typeof choice !== 'object') {
        throw new ChatUnavailableError('malformed response (no choices)');
      }
      // `reasoning_content` (thinking models) is ignored on purpose.
      const content = choice.message?.content;
      const usage = data.usage;
      return {
        text: typeof content === 'string' ? content : '',
        finishReason: choice.finish_reason ?? null,
        usage: usage && typeof usage === 'object'
          ? { promptTokens: usage.prompt_tokens ?? null, completionTokens: usage.completion_tokens ?? null }
          : null,
      };
    },
  };
}

module.exports = { createOpenAIProvider, ChatTimeoutError, ChatUnavailableError };
