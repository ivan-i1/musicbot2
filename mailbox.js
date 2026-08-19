// mailbox.js
//
// Deferred message delivery for /mailbox.
//
// The command advertises "get a mention once mentioned person is online", so
// a message for an offline user has to outlive both the command invocation
// and a bot restart. That means real persistence, not an in-memory Map.
//
// Scale assumption: a hobby bot on a small server. A JSON file rewritten on
// every mutation is the right amount of machinery here; if this ever grows to
// thousands of queued messages, swap the two fs calls for a real database.

const fs = require('node:fs');
const path = require('node:path');

const AVAILABLE_STATUSES = new Set(['online', 'idle', 'dnd']);

/**
 * Is this presence one we can reach a human through?
 * `invisible` deliberately counts as unreachable — the user asked to appear
 * offline, and delivering to them would leak that they are not.
 *
 * @param {{status?: string}|null|undefined} presence
 * @returns {boolean}
 */
function isAvailable(presence) {
  return Boolean(presence) && AVAILABLE_STATUSES.has(presence.status);
}

/**
 * Did this presenceUpdate represent a transition INTO availability?
 *
 * Only the edge matters: an already-online user flipping online -> idle must
 * not re-trigger delivery. A null oldPresence (the bot has just started and
 * has no cached presence) is treated as previously-unavailable, so mail is
 * still delivered on the first event we see.
 *
 * @param {{status?: string}|null|undefined} oldPresence
 * @param {{status?: string}|null|undefined} newPresence
 * @returns {boolean}
 */
function becameAvailable(oldPresence, newPresence) {
  return isAvailable(newPresence) && !isAvailable(oldPresence);
}

class MailboxStore {
  /**
   * @param {string} filePath - JSON file backing the queue.
   * @param {() => string} clock - returns an ISO timestamp; injectable so
   *   tests do not depend on the wall clock.
   */
  constructor(filePath, clock = () => new Date().toISOString()) {
    this.filePath = filePath;
    this.clock = clock;
    this.data = this.#read();
  }

  #read() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      // Guard against a hand-edited or truncated file holding the wrong shape.
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[Mailbox] Could not read ${this.filePath}, starting empty:`, error.message);
      }
      return {};
    }
  }

  #write() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Write-then-rename so a crash mid-write cannot leave a truncated file
    // that the next start would report as corrupt.
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  /**
   * Queue a message for later delivery.
   * @param {string} recipientId
   * @param {{fromTag: string, message: string}} entry
   */
  add(recipientId, { fromTag, message }) {
    if (!this.data[recipientId]) this.data[recipientId] = [];
    this.data[recipientId].push({ fromTag, message, queuedAt: this.clock() });
    this.#write();
  }

  /** @returns {Array<object>} pending messages, without removing them. */
  pendingFor(recipientId) {
    return this.data[recipientId] ? [...this.data[recipientId]] : [];
  }

  /**
   * Return and REMOVE every pending message for a recipient. The removal is
   * persisted before the caller delivers, so a crash mid-delivery loses mail
   * rather than delivering it twice on the next start.
   * @returns {Array<object>}
   */
  takeFor(recipientId) {
    const pending = this.pendingFor(recipientId);
    if (pending.length === 0) return [];

    delete this.data[recipientId];
    this.#write();
    return pending;
  }

  /** @returns {string[]} recipient IDs that currently have mail waiting. */
  recipientsWithMail() {
    return Object.keys(this.data).filter(id => this.data[id]?.length > 0);
  }
}

module.exports = { MailboxStore, isAvailable, becameAvailable };
