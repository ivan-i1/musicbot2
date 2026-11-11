const test = require('node:test');
const assert = require('node:assert/strict');

const { ChatGate } = require('../chat/gate.js');

/** A manual clock: sleep() advances time instantly and records how long it was asked to wait. */
function fakeClock(start = 1_000_000) {
  const clock = { t: start, sleeps: [] };
  clock.now = () => clock.t;
  clock.sleep = async ms => { clock.sleeps.push(ms); clock.t += ms; };
  return clock;
}

function gate(clock, overrides = {}) {
  return new ChatGate({
    queueMax: 3, cooldownMs: 20000, gapMs: 5000,
    now: clock.now, sleep: clock.sleep, ...overrides,
  });
}

/** A promise plus its resolver, to hold a job "running" until the test lets go. */
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

const tick = () => new Promise(r => setImmediate(r));

// --- cooldown -----------------------------------------------------------------

test('a second request from the same user inside the cooldown is refused with retryInS', () => {
  const clock = fakeClock();
  const g = gate(clock);

  assert.equal(g.admit('u1').ok, true);
  clock.t += 7500;
  assert.deepEqual(g.admit('u1'), { ok: false, reason: 'cooldown', retryInS: 13 });
});

test('the cooldown expires', () => {
  const clock = fakeClock();
  const g = gate(clock);

  g.admit('u1').ticket.cancel();
  clock.t += 20000;
  assert.equal(g.admit('u1').ok, true);
});

test('the cooldown is per user', () => {
  const g = gate(fakeClock());
  assert.equal(g.admit('u1').ok, true);
  assert.equal(g.admit('u2').ok, true);
});

test('the cooldown starts only on an accepted request — a busy refusal does not consume it', () => {
  const clock = fakeClock();
  const g = gate(clock, { queueMax: 0 });

  assert.equal(g.admit('u1').ok, true); // holds the only place
  assert.deepEqual(g.admit('u2'), { ok: false, reason: 'busy' });
  assert.equal(g.cooldownRemainingMs('u2'), 0);
});

test('cancel frees the place but keeps the cooldown stamped', () => {
  const clock = fakeClock();
  const g = gate(clock, { queueMax: 0 });

  g.admit('u1').ticket.cancel();
  assert.equal(g.admit('u2').ok, true, 'place freed');
  assert.equal(g.admit('u1').reason, 'cooldown', 'cooldown kept');
});

// --- capacity -----------------------------------------------------------------

test('busy when 1 running + queueMax waiting are already reserved', () => {
  const g = gate(fakeClock(), { cooldownMs: 0 });

  for (let i = 0; i < 4; i++) assert.equal(g.admit(`u${i}`).ok, true, `place ${i}`);
  assert.deepEqual(g.admit('u9'), { ok: false, reason: 'busy' });
});

test('race: two synchronous admits for the last place — one ok, one busy', () => {
  const g = gate(fakeClock(), { queueMax: 0 });

  const a = g.admit('a');
  const b = g.admit('b');
  assert.equal(a.ok, true);
  assert.deepEqual(b, { ok: false, reason: 'busy' });
});

test('a finished job releases its place', async () => {
  const g = gate(fakeClock(), { queueMax: 0 });

  await g.admit('a').ticket.run(async () => 'done');
  assert.equal(g.admit('b').ok, true);
});

test('a job that throws still releases its place, and the error reaches the caller', async () => {
  const g = gate(fakeClock(), { queueMax: 0 });

  await assert.rejects(g.admit('a').ticket.run(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(g.admit('b').ok, true);
});

test('cancel is idempotent and a cancelled ticket cannot run', async () => {
  const g = gate(fakeClock(), { queueMax: 1, cooldownMs: 0 });

  const { ticket } = g.admit('a');
  ticket.cancel();
  ticket.cancel();
  await assert.rejects(ticket.run(async () => {}), /cancelled/);

  assert.equal(g.admit('b').ok, true);
  assert.equal(g.admit('c').ok, true);
  assert.equal(g.admit('d').ok, false, 'double cancel did not free two places');
});

// --- ordering -----------------------------------------------------------------

test('jobs run in FIFO order and never two at once', async () => {
  const g = gate(fakeClock(), { cooldownMs: 0, gapMs: 0 });
  const order = [];
  let active = 0;
  let peak = 0;

  const holds = [deferred(), deferred(), deferred()];
  const runs = holds.map((hold, i) => g.admit(`u${i}`).ticket.run(async () => {
    active++;
    peak = Math.max(peak, active);
    order.push(i);
    await hold.promise;
    active--;
    return i;
  }));

  await tick();
  assert.deepEqual(order, [0], 'only the first started');

  holds[0].resolve();
  await tick();
  assert.deepEqual(order, [0, 1]);

  holds[1].resolve();
  holds[2].resolve();
  assert.deepEqual(await Promise.all(runs), [0, 1, 2]);
  assert.equal(peak, 1, 'single flight');
});

test('a queued job does not start until it reaches the front (its fn runs late)', async () => {
  const g = gate(fakeClock(), { cooldownMs: 0, gapMs: 0 });
  const hold = deferred();
  let secondStarted = false;

  const first = g.admit('a').ticket.run(() => hold.promise);
  const second = g.admit('b').ticket.run(async () => { secondStarted = true; });

  await tick();
  assert.equal(secondStarted, false);
  hold.resolve();
  await Promise.all([first, second]);
  assert.equal(secondStarted, true);
});

// --- global gap ---------------------------------------------------------------

test('the next job starts at least gapMs after the previous one ended', async () => {
  const clock = fakeClock();
  const g = gate(clock, { cooldownMs: 0 });
  const starts = [];
  const job = async () => { starts.push(clock.t); clock.t += 3000; };

  await Promise.all([
    g.admit('a').ticket.run(job),
    g.admit('b').ticket.run(job),
  ]);

  assert.equal(starts[1] - (starts[0] + 3000), 5000);
});

test('the gap is measured from the last end, so an idle bot never sleeps', async () => {
  const clock = fakeClock();
  const g = gate(clock, { cooldownMs: 0 });

  await g.admit('a').ticket.run(async () => {});
  assert.deepEqual(clock.sleeps, [], 'first job ever: no wait');

  clock.t += 60000; // idle for a minute
  await g.admit('b').ticket.run(async () => {});
  assert.deepEqual(clock.sleeps, [], 'after an idle period: no wait');
});

test('only the remainder of the gap is waited when part of it has already passed', async () => {
  const clock = fakeClock();
  const g = gate(clock, { cooldownMs: 0 });

  await g.admit('a').ticket.run(async () => {});
  clock.t += 2000;
  await g.admit('b').ticket.run(async () => {});
  assert.deepEqual(clock.sleeps, [3000]);
});
