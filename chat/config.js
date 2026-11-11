// chat/config.js
//
// Reads the LLM_* environment keys for /chat. Pure: takes an env object and
// returns a plain config, so every default and fallback is unit-testable.
//
// Chat is OFF unless LLM_BASE_URL is set. The bot speaks the OpenAI-compatible
// chat API to that URL, so swapping models (or runtimes) is config only.

const DEFAULT_SYSTEM_PROMPT =
  'You are the music bot of this Discord server: friendly, playful, brief. ' +
  'Reply in the language the user writes in, in 1 to 3 sentences. ' +
  "Messages are prefixed with the speaker's name. " +
  "If you don't know something, say so; never invent facts. " +
  'Never ping or mention people.';

// key → [config field, default, kind]. `int0` allows zero (e.g. no cooldown);
// `int` must be positive; `float0` is a non-negative decimal.
const NUMERIC = [
  ['LLM_MAX_TOKENS', 'maxTokens', 200, 'int'],
  ['LLM_TIMEOUT_MS', 'timeoutMs', 120000, 'int'],
  ['LLM_QUEUE_MAX', 'queueMax', 3, 'int0'],
  ['LLM_COOLDOWN_MS', 'cooldownMs', 20000, 'int0'],
  ['LLM_GAP_MS', 'gapMs', 5000, 'int0'],
  ['LLM_HISTORY_CHARS', 'historyChars', 2400, 'int0'],
  ['LLM_TEMPERATURE', 'temperature', 0.7, 'float0'],
];

function isValid(value, kind) {
  if (!Number.isFinite(value) || value < 0) return false;
  if (kind === 'float0') return true;
  if (!Number.isInteger(value)) return false;
  return kind === 'int0' || value > 0;
}

/**
 * @param {Record<string, string|undefined>} env - usually process.env.
 * @param {{warn?: (msg: string) => void}} [options]
 */
function parseChatConfig(env, { warn = console.warn } = {}) {
  const rawUrl = (env.LLM_BASE_URL || '').trim();
  const baseUrl = rawUrl ? rawUrl.replace(/\/+$/, '') : null;

  const config = {
    enabled: Boolean(baseUrl),
    baseUrl,
    model: (env.LLM_MODEL || '').trim() || 'chat',
    apiKey: (env.LLM_API_KEY || '').trim() || null,
  };

  for (const [key, field, fallback, kind] of NUMERIC) {
    const raw = (env[key] ?? '').trim();
    if (raw === '') {
      config[field] = fallback;
      continue;
    }
    const value = Number(raw);
    if (isValid(value, kind)) {
      config[field] = value;
    } else {
      // Never echo anything but the key — a misplaced secret could land here.
      warn(`[Chat] Ignoring invalid ${key}; using the default (${fallback}).`);
      config[field] = fallback;
    }
  }

  config.systemPrompt = (env.LLM_SYSTEM_PROMPT || '').trim() || DEFAULT_SYSTEM_PROMPT;
  return config;
}

module.exports = { parseChatConfig, DEFAULT_SYSTEM_PROMPT };
