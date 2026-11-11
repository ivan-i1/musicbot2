// chat/gate.js
//
// Admission control for /chat. There is ONE llama slot for every guild and
// channel, so this is a single global FIFO: one job running, up to `queueMax`
// waiting. On top of that:
//   - a per-user cooldown, stamped only when a request is accepted;
//   - a global gap — the next generation starts at least `gapMs` after the
//     previous one ENDED. This is the heat guard: a few users taking turns
//     could otherwise keep the core at 100% indefinitely.
//
// `admit()` reserves a place SYNCHRONOUSLY — no await between the check and
// the reservation — so two users racing for the last place while their
// `deferReply()` is in flight cannot both get it. The caller then either
// `run()`s the ticket or `cancel()`s it (e.g. if deferReply threw).
//
// Clock and sleep are injected so tests never wait for real time.

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class ChatGate {
  /**
   * @param {{queueMax: number, cooldownMs: number, gapMs: number,
   *          now?: () => number, sleep?: (ms: number) => Promise<void>}} options
   */
  constructor({ queueMax, cooldownMs, gapMs, now = Date.now, sleep = defaultSleep }) {
    this.queueMax = queueMax;
    this.cooldownMs = cooldownMs;
    this.gapMs = gapMs;
    this._now = now;
    this._sleep = sleep;

    this._reserved = 0; // admitted and not yet released: running + waiting
    this._lastAccepted = new Map(); // userId → timestamp
    this._lastEndTs = -Infinity;
    this._tail = Promise.resolve(); // FIFO chain
  }

  /** Milliseconds until this user may be admitted again (0 = now). */
  cooldownRemainingMs(userId) {
    const last = this._lastAccepted.get(userId);
    if (last === undefined) return 0;
    return Math.max(0, last + this.cooldownMs - this._now());
  }

  /**
   * @returns {{ok: true, ticket: {run: (fn: () => Promise<any>) => Promise<any>, cancel: () => void}}
   *         | {ok: false, reason: 'cooldown', retryInS: number}
   *         | {ok: false, reason: 'busy'}}
   */
  admit(userId) {
    const remaining = this.cooldownRemainingMs(userId);
    if (remaining > 0) {
      return { ok: false, reason: 'cooldown', retryInS: Math.ceil(remaining / 1000) };
    }
    if (this._reserved >= this.queueMax + 1) {
      return { ok: false, reason: 'busy' };
    }

    this._lastAccepted.set(userId, this._now());
    this._reserved++;
    return { ok: true, ticket: this._ticket() };
  }

  _ticket() {
    let state = 'reserved'; // → 'used' | 'cancelled'
    const release = () => { this._reserved--; };

    return {
      run: fn => {
        if (state !== 'reserved') return Promise.reject(new Error(`ticket already ${state}`));
        state = 'used';

        const job = this._tail.then(async () => {
          // Checked at START, against the last END — an idle bot never sleeps.
          const wait = this._lastEndTs + this.gapMs - this._now();
          if (wait > 0) await this._sleep(wait);
          try {
            return await fn();
          } finally {
            this._lastEndTs = this._now();
            release();
          }
        });
        // The chain must survive a failed job; the caller still sees the rejection.
        this._tail = job.catch(() => {});
        return job;
      },
      cancel: () => {
        if (state !== 'reserved') return;
        state = 'cancelled';
        release();
      },
    };
  }
}

module.exports = { ChatGate };
