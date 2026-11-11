const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  createOpenAIProvider,
  ChatTimeoutError,
  ChatUnavailableError,
} = require('../chat/provider.js');

const MESSAGES = [{ role: 'user', content: 'Ana: hola' }];

/** A fake fetch that records the request and answers with `body`. */
function fakeFetch(body = { choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] }) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

// --- real local servers -------------------------------------------------------

const servers = [];

/** Start a node:http server on a random loopback port; returns its /v1 base URL. */
async function startServer(handler) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

// --- request shape ------------------------------------------------------------

test('POSTs the OpenAI chat body to <baseUrl>/chat/completions, max_tokens included', async () => {
  const { fetch, calls } = fakeFetch();
  const provider = createOpenAIProvider({ baseUrl: 'http://llm:8080/v1', model: 'chat', fetch });

  await provider.complete({ messages: MESSAGES, maxTokens: 200, temperature: 0.7 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://llm:8080/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].body, { model: 'chat', messages: MESSAGES, max_tokens: 200, temperature: 0.7 });
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
});

test('never sends a conversation-id header, and no Authorization without a key', async () => {
  const { fetch, calls } = fakeFetch();
  const provider = createOpenAIProvider({ baseUrl: 'http://x/v1', model: 'chat', fetch });
  await provider.complete({ messages: MESSAGES, maxTokens: 10, temperature: 0 });

  const names = Object.keys(calls[0].init.headers).map(h => h.toLowerCase());
  assert.ok(!names.includes('x-conversation-id'));
  assert.ok(!names.includes('authorization'));
});

test('sends a Bearer token only when an API key is set', async () => {
  const { fetch, calls } = fakeFetch();
  const provider = createOpenAIProvider({ baseUrl: 'http://x/v1', model: 'chat', apiKey: 'sk-1', fetch });
  await provider.complete({ messages: MESSAGES, maxTokens: 10, temperature: 0 });

  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-1');
});

test('passes the caller\'s signal through to fetch', async () => {
  const { fetch, calls } = fakeFetch();
  const provider = createOpenAIProvider({ baseUrl: 'http://x/v1', model: 'chat', fetch });
  const signal = AbortSignal.timeout(60000);
  await provider.complete({ messages: MESSAGES, maxTokens: 10, temperature: 0, signal });

  assert.equal(calls[0].init.signal, signal);
});

// --- response parsing ---------------------------------------------------------

test('returns choices[0].message.content and the finish reason, ignoring reasoning_content', async () => {
  const { fetch } = fakeFetch({
    choices: [{ message: { content: '¡Hola!', reasoning_content: 'secret thoughts' }, finish_reason: 'length' }],
  });
  const provider = createOpenAIProvider({ baseUrl: 'http://x/v1', model: 'chat', fetch });

  assert.deepEqual(
    await provider.complete({ messages: MESSAGES, maxTokens: 10, temperature: 0 }),
    { text: '¡Hola!', finishReason: 'length', usage: null },
  );
});

test('returns the token usage counts when the server reports them (for the [Chat] log line)', async () => {
  const { fetch } = fakeFetch({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 },
  });
  const provider = createOpenAIProvider({ baseUrl: 'http://x/v1', model: 'chat', fetch });

  const { usage } = await provider.complete({ messages: MESSAGES, maxTokens: 10, temperature: 0 });
  assert.deepEqual(usage, { promptTokens: 120, completionTokens: 8 });
});

test('a null content becomes an empty string (the caller shows EMPTY_REPLY)', async () => {
  const { fetch } = fakeFetch({ choices: [{ message: { content: null }, finish_reason: 'stop' }] });
  const provider = createOpenAIProvider({ baseUrl: 'http://x/v1', model: 'chat', fetch });

  const { text } = await provider.complete({ messages: MESSAGES, maxTokens: 10, temperature: 0 });
  assert.equal(text, '');
});

test('a body without choices is Unavailable', async () => {
  const { fetch } = fakeFetch({ error: 'nope' });
  const provider = createOpenAIProvider({ baseUrl: 'http://x/v1', model: 'chat', fetch });

  await assert.rejects(provider.complete({ messages: MESSAGES, maxTokens: 10, temperature: 0 }), ChatUnavailableError);
});

// --- failure classes, against a real server -----------------------------------

test('a 503 (model still loading) is Unavailable and the message carries the status, not the body', async () => {
  const { baseUrl } = await startServer((req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Loading model SECRET-BODY' } }));
  });
  const provider = createOpenAIProvider({ baseUrl, model: 'chat' });

  const err = await provider.complete({ messages: MESSAGES, maxTokens: 10, temperature: 0 }).catch(e => e);
  assert.ok(err instanceof ChatUnavailableError, `got ${err}`);
  assert.match(err.message, /503/);
  assert.doesNotMatch(err.message, /SECRET-BODY/);
});

test('malformed JSON from a 200 is Unavailable', async () => {
  const { baseUrl } = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"choices": [ not json');
  });
  const provider = createOpenAIProvider({ baseUrl, model: 'chat' });

  await assert.rejects(provider.complete({ messages: MESSAGES, maxTokens: 10, temperature: 0 }), ChatUnavailableError);
});

test('connection refused is Unavailable', async () => {
  // Bind then close, so the port is known to have nothing listening.
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));

  const provider = createOpenAIProvider({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'chat' });
  const err = await provider.complete({ messages: MESSAGES, maxTokens: 10, temperature: 0 }).catch(e => e);
  assert.ok(err instanceof ChatUnavailableError, `got ${err}`);
  assert.match(err.message, /ECONNREFUSED/);
});

test('a slow server is a Timeout once the signal fires, and the server sees the connection drop', async () => {
  let closed;
  const serverSawClose = new Promise(resolve => { closed = resolve; });
  const { baseUrl } = await startServer((req, res) => {
    res.on('close', closed); // never answers — like a long generation
  });
  const provider = createOpenAIProvider({ baseUrl, model: 'chat' });

  const err = await provider
    .complete({ messages: MESSAGES, maxTokens: 10, temperature: 0, signal: AbortSignal.timeout(150) })
    .catch(e => e);
  assert.ok(err instanceof ChatTimeoutError, `got ${err}`);
  await serverSawClose; // llama-server cancels when it notices the closed connection
});

test('a timeout while the body is still streaming is also a Timeout, not Unavailable', async () => {
  const { baseUrl } = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"choices": ['); // headers + part of the body, then stall
  });
  const provider = createOpenAIProvider({ baseUrl, model: 'chat' });

  const err = await provider
    .complete({ messages: MESSAGES, maxTokens: 10, temperature: 0, signal: AbortSignal.timeout(150) })
    .catch(e => e);
  assert.ok(err instanceof ChatTimeoutError, `got ${err}`);
});

test('a manual abort is classed as a Timeout', async () => {
  const fetch = async (url, init) => {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };
  const provider = createOpenAIProvider({ baseUrl: 'http://x/v1', model: 'chat', fetch });

  await assert.rejects(provider.complete({ messages: MESSAGES, maxTokens: 10, temperature: 0 }), ChatTimeoutError);
});
