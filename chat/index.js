// chat/index.js
//
// Assembles the /chat services from env. index.js hangs the result off
// `client.chat`, the same way it does `client.mailbox` and `client.music`;
// commands/chat.js reaches it via `interaction.client.chat`.
//
// The bot must run without the llm container: with LLM_BASE_URL unset there
// is no provider at all and /chat answers "not set up".

const { parseChatConfig } = require('./config.js');
const { ChannelHistory } = require('./history.js');
const { ChatGate } = require('./gate.js');
const { createOpenAIProvider } = require('./provider.js');

/**
 * @param {Record<string, string|undefined>} env - usually process.env.
 * @param {{warn?: (msg: string) => void}} [options]
 */
function createChat(env, options) {
  const config = parseChatConfig(env, options);
  return {
    config,
    history: new ChannelHistory(),
    gate: new ChatGate({ queueMax: config.queueMax, cooldownMs: config.cooldownMs, gapMs: config.gapMs }),
    provider: config.enabled
      ? createOpenAIProvider({ baseUrl: config.baseUrl, model: config.model, apiKey: config.apiKey })
      : null,
  };
}

/** The startup log line. Never includes the API key. */
function chatStatusLine(config) {
  return config.enabled
    ? `[Chat] Enabled → ${config.baseUrl} (model ${config.model})`
    : '[Chat] Disabled — set LLM_BASE_URL';
}

module.exports = { createChat, chatStatusLine };
