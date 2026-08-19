// music/library.js
//
// Turns whatever a user typed into /play into something safe to hand to
// ffmpeg — or refuses.
//
// This is a security boundary, not a convenience. ffmpeg will open almost
// anything it is given: `file://`, `concat:`, `ftp://`, and a relative path
// full of `..` all resolve to real bytes on the host. Without the checks
// below, any user who can type a slash command in the server could stream
// arbitrary files off the machine into a voice channel they are sitting in.

const fs = require('node:fs');
const path = require('node:path');

/** Rejection with a message that is safe to show a user. */
class TrackError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TrackError';
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Does `candidate` sit inside `root`?
 * Both must already be real (symlink-resolved) absolute paths.
 */
function isInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * @param {string} input - raw user input from /play.
 * @param {{musicDir: string|null}} options
 * @returns {{kind: 'file', path: string, title: string} | {kind: 'url', url: string, title: string}}
 * @throws {TrackError}
 */
function resolveTrack(input, { musicDir }) {
  const trimmed = (input ?? '').trim();
  if (!trimmed) throw new TrackError('Give me a file name or a URL to play.');

  // A string with a scheme is a URL attempt — decide on the scheme alone, and
  // never fall through to the path branch, or `file:///x` would be treated as
  // a relative filename.
  const asUrl = tryParseUrl(trimmed);
  if (asUrl) {
    if (!ALLOWED_PROTOCOLS.has(asUrl.protocol)) {
      throw new TrackError(`Only http and https links are allowed — not \`${asUrl.protocol}\``);
    }
    return {
      kind: 'url',
      url: asUrl.href,
      title: decodeURIComponent(path.basename(asUrl.pathname)) || asUrl.hostname,
    };
  }

  // ffmpeg protocol syntax without `//` (e.g. `concat:/etc/passwd`) does not
  // parse as a URL, so screen for a bare scheme prefix explicitly.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    throw new TrackError('That looks like a protocol I will not open. Use a file name or an http(s) link.');
  }

  if (!musicDir) {
    throw new TrackError('Local files are not enabled — set MUSIC_DIR in .env. You can still play http(s) links.');
  }

  let root;
  try {
    root = fs.realpathSync(musicDir);
  } catch {
    throw new TrackError('The configured MUSIC_DIR does not exist on this machine.');
  }

  const requested = path.resolve(root, trimmed);

  let real;
  try {
    // realpath AFTER resolving, so a symlink inside the music dir pointing
    // outside it is caught. Checking containment on the pre-symlink path
    // would pass and then happily read the target.
    real = fs.realpathSync(requested);
  } catch {
    throw new TrackError(`I cannot find \`${trimmed}\` in the music library.`);
  }

  if (!isInside(root, real)) {
    throw new TrackError('That path is outside the music library.');
  }

  if (!fs.statSync(real).isFile()) {
    throw new TrackError(`\`${trimmed}\` is not a file.`);
  }

  return { kind: 'file', path: real, title: path.basename(real) };
}

function tryParseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

module.exports = { resolveTrack, TrackError, isInside };
