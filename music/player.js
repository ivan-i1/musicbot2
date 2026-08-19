// music/player.js
//
// The voice half of playback. Most of this cannot be unit-tested — it needs a
// live gateway connection and a real voice channel — so the logic that CAN be
// isolated lives in music/queue.js and music/library.js, and the one piece
// with observable output (the ffmpeg -> Ogg Opus stream) is exercised
// directly by test/player.test.js.

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const prism = require('prism-media');

const { QueueRegistry } = require('./queue.js');

// prism-media resolves ffmpeg-static on its own, but being explicit means a
// missing binary fails here with a clear message instead of deep inside a
// stream error nobody sees.
const ffmpegPath = require('ffmpeg-static');

/**
 * ffmpeg arguments for a track.
 *
 * The reconnect options are HTTP-PROTOCOL options: ffmpeg rejects them for a
 * file input with "Option reconnect not found" and exits before producing a
 * byte. They must only be passed for http(s) sources.
 *
 * @param {{kind: 'file'|'url', path?: string, url?: string}} track
 * @returns {string[]}
 */
function buildFfmpegArgs(track) {
  const source = track.kind === 'file' ? track.path : track.url;
  if (!source) throw new Error('Track has neither a path nor a url');

  const inputOptions = track.kind === 'url'
    ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5']
    : [];

  return [
    '-analyzeduration', '0',
    '-loglevel', 'error',
    ...inputOptions,
    '-i', source,
    '-vn',                    // never try to carry a video stream
    '-c:a', 'libopus',
    '-f', 'opus',
    '-ar', '48000',           // Discord requires 48kHz stereo
    '-ac', '2',
    '-b:a', '96k',
  ];
}

/**
 * Build an Ogg Opus stream for a track.
 *
 * ffmpeg encodes Opus itself (the ffmpeg-static build ships --enable-libopus),
 * so @discordjs/voice only has to demux. That is what lets this bot run with
 * NO native opus module — @discordjs/opus has no prebuilt binary for Node 26
 * and would fall back to a source compile that fails on a bare host.
 *
 * @param {{kind: 'file'|'url', path?: string, url?: string}} track
 * @returns {import('node:stream').Readable}
 */
function createTrackStream(track) {
  return new prism.FFmpeg({ command: ffmpegPath, args: buildFfmpegArgs(track) });
}

/** @param {{kind: string, path?: string, url?: string}} track */
function createTrackResource(track) {
  return createAudioResource(createTrackStream(track), {
    inputType: StreamType.OggOpus,
    metadata: track,
  });
}

class MusicManager {
  constructor() {
    this.queues = new QueueRegistry();
    /** @type {Map<string, {player: object, connection: object}>} */
    this.sessions = new Map();
  }

  queueFor(guildId) {
    return this.queues.for(guildId);
  }

  /**
   * Join `voiceChannel` if not already connected, and return the session.
   * Idempotent — calling it while connected reuses the existing player.
   */
  async connect(voiceChannel) {
    const guildId = voiceChannel.guild.id;
    const existing = this.sessions.get(guildId);
    if (existing) return existing;

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);

    // Idle fires both when a track ends naturally and after stop() — either
    // way the right move is to advance the queue.
    player.on(AudioPlayerStatus.Idle, () => this.#advance(guildId));
    player.on('error', error => {
      console.error(`[Music] Player error in guild ${guildId}:`, error.message);
      this.#advance(guildId);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Could be a move between channels rather than a real disconnect;
        // give it a moment to re-establish before tearing everything down.
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy(guildId);
      }
    });

    const session = { player, connection };
    this.sessions.set(guildId, session);
    return session;
  }

  /** Start the queue's current track, if anything is waiting and nothing is playing. */
  startIfIdle(guildId) {
    const session = this.sessions.get(guildId);
    const queue = this.queueFor(guildId);
    if (!session || !queue.current) return false;
    if (session.player.state.status !== AudioPlayerStatus.Idle) return false;

    session.player.play(createTrackResource(queue.current));
    return true;
  }

  #advance(guildId) {
    const queue = this.queueFor(guildId);
    const nextTrack = queue.next();

    if (!nextTrack) {
      // Nothing left — leave the channel rather than sitting there silently.
      this.destroy(guildId);
      return;
    }

    const session = this.sessions.get(guildId);
    if (session) session.player.play(createTrackResource(nextTrack));
  }

  /** Skip the current track. Returns the track that was skipped, if any. */
  skip(guildId) {
    const skipped = this.queueFor(guildId).current;
    const session = this.sessions.get(guildId);
    // stop() triggers Idle, which runs #advance for us.
    if (session) session.player.stop();
    return skipped;
  }

  /** Stop playback, clear the queue and leave the channel. */
  destroy(guildId) {
    const session = this.sessions.get(guildId);
    if (session) {
      session.player.stop();
      try {
        session.connection.destroy();
      } catch {
        // already torn down — nothing to do
      }
      this.sessions.delete(guildId);
    }
    this.queues.for(guildId).stop();
    this.queues.drop(guildId);
  }

  isConnected(guildId) {
    return this.sessions.has(guildId);
  }
}

module.exports = { MusicManager, buildFfmpegArgs, createTrackStream, createTrackResource, ffmpegPath };
