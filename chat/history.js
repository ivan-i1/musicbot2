// chat/history.js
//
// Per-channel conversation memory for /chat. In memory only — a restart
// forgets every conversation, which is accepted for a toy chat.
//
// History is shared by everyone in a channel (threads get their own, since a
// thread has its own channel id), so each past user turn is prefixed with the
// speaker's name for the model to tell people apart.

const { capStoredAnswer } = require('./format.js');

const MAX_PAIRS = 20;

class ChannelHistory {
  constructor() {
    /** @type {Map<string, {name: string, user: string, assistant: string}[]>} */
    this._channels = new Map();
  }

  /** Record one successful exchange. Failed or empty exchanges must not be appended. */
  append(channelId, { name, user, assistant }) {
    const pairs = this._channels.get(channelId) ?? [];
    pairs.push({ name, user, assistant: capStoredAnswer(assistant) });
    if (pairs.length > MAX_PAIRS) pairs.splice(0, pairs.length - MAX_PAIRS);
    this._channels.set(channelId, pairs);
  }

  /**
   * The OpenAI-style message list for a new turn: system prompt, then as many
   * of the newest pairs as fit in `budgetChars`, then the new message. The
   * budget covers past pairs only — the system prompt and the new message are
   * always sent.
   */
  build(channelId, { systemPrompt, name, message, budgetChars }) {
    const pairs = this._channels.get(channelId) ?? [];

    const kept = [];
    let used = 0;
    for (let i = pairs.length - 1; i >= 0; i--) {
      const user = `${pairs[i].name}: ${pairs[i].user}`;
      const cost = user.length + pairs[i].assistant.length;
      if (used + cost > budgetChars) break;
      used += cost;
      kept.unshift(
        { role: 'user', content: user },
        { role: 'assistant', content: pairs[i].assistant },
      );
    }

    return [
      { role: 'system', content: systemPrompt },
      ...kept,
      { role: 'user', content: `${name}: ${message}` },
    ];
  }
}

module.exports = { ChannelHistory, MAX_PAIRS };
