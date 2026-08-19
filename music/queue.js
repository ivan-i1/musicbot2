// music/queue.js
//
// Per-guild playback queues. Pure data structures with no discord.js and no
// voice objects, so the ordering rules are unit-testable — the voice layer in
// music/player.js is the part that cannot be.

/**
 * @typedef {{kind: 'file'|'url', title: string, path?: string, url?: string, requestedBy?: string}} Track
 */

class GuildQueue {
  constructor() {
    /** @type {Track|null} */
    this.current = null;
    /** @type {Track[]} */
    this._upcoming = [];
  }

  /** Queued tracks, excluding the one playing. A copy — mutating it does nothing. */
  get upcoming() {
    return [...this._upcoming];
  }

  get isEmpty() {
    return this.current === null && this._upcoming.length === 0;
  }

  /** Total tracks including the one playing. */
  get size() {
    return (this.current ? 1 : 0) + this._upcoming.length;
  }

  /**
   * @param {Track} track
   * @returns {number} how many tracks are ahead of it — 0 means it starts now.
   */
  add(track) {
    if (this.current === null) {
      this.current = track;
      return 0;
    }
    this._upcoming.push(track);
    return this._upcoming.length;
  }

  /**
   * Advance to the next track.
   * @returns {Track|null} the new current track, or null if the queue ran dry.
   */
  next() {
    this.current = this._upcoming.shift() ?? null;
    return this.current;
  }

  /** Drop everything, including whatever is playing. */
  stop() {
    this.current = null;
    this._upcoming = [];
  }

  /**
   * Empty the queue but leave the current track alone — /clear should not cut
   * off the song already playing.
   * @returns {number} how many queued tracks were removed.
   */
  clear() {
    const removed = this._upcoming.length;
    this._upcoming = [];
    return removed;
  }

  /** Current track first, then upcoming. */
  list() {
    return this.current ? [this.current, ...this._upcoming] : [];
  }
}

class QueueRegistry {
  constructor() {
    /** @type {Map<string, GuildQueue>} */
    this.queues = new Map();
  }

  /** Get (creating if needed) the queue for a guild. */
  for(guildId) {
    if (!this.queues.has(guildId)) this.queues.set(guildId, new GuildQueue());
    return this.queues.get(guildId);
  }

  /** Forget a guild's queue — called when the bot leaves the voice channel. */
  drop(guildId) {
    this.queues.delete(guildId);
  }
}

module.exports = { GuildQueue, QueueRegistry };
