const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveTrack, TrackError } = require('../music/library.js');

/** A music dir with one real track, plus a secret sitting OUTSIDE it. */
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'music-')));
  const musicDir = path.join(root, 'music');
  fs.mkdirSync(path.join(musicDir, 'albums'), { recursive: true });
  fs.writeFileSync(path.join(musicDir, 'song.mp3'), 'ID3fake');
  fs.writeFileSync(path.join(musicDir, 'albums', 'deep.mp3'), 'ID3fake');
  fs.writeFileSync(path.join(root, 'secret.mp3'), 'PRIVATE');
  return { root, musicDir };
}

// ------------------------------------------------------------ local files

test('resolves a file inside the music directory', () => {
  const { musicDir } = fixture();
  const track = resolveTrack('song.mp3', { musicDir });

  assert.equal(track.kind, 'file');
  assert.equal(track.title, 'song.mp3');
  assert.equal(track.path, path.join(musicDir, 'song.mp3'));
});

test('resolves a file in a subdirectory', () => {
  const { musicDir } = fixture();
  assert.equal(resolveTrack('albums/deep.mp3', { musicDir }).title, 'deep.mp3');
});

test('REJECTS path traversal out of the music directory', () => {
  const { musicDir } = fixture();
  assert.throws(
    () => resolveTrack('../secret.mp3', { musicDir }),
    TrackError,
    'any Discord user could otherwise stream arbitrary host files into voice',
  );
});

test('REJECTS a deeply disguised traversal', () => {
  const { musicDir } = fixture();
  assert.throws(() => resolveTrack('albums/../../secret.mp3', { musicDir }), TrackError);
});

test('REJECTS an absolute path outside the music directory', () => {
  const { root, musicDir } = fixture();
  assert.throws(() => resolveTrack(path.join(root, 'secret.mp3'), { musicDir }), TrackError);
});

test('accepts an absolute path that really is inside the music directory', () => {
  const { musicDir } = fixture();
  assert.equal(resolveTrack(path.join(musicDir, 'song.mp3'), { musicDir }).kind, 'file');
});

test('REJECTS a symlink that escapes the music directory', () => {
  const { root, musicDir } = fixture();
  fs.symlinkSync(path.join(root, 'secret.mp3'), path.join(musicDir, 'escape.mp3'));

  assert.throws(
    () => resolveTrack('escape.mp3', { musicDir }),
    TrackError,
    'containment must be checked after resolving symlinks, not before',
  );
});

test('REJECTS a file that does not exist', () => {
  const { musicDir } = fixture();
  assert.throws(() => resolveTrack('nope.mp3', { musicDir }), TrackError);
});

test('REJECTS a directory', () => {
  const { musicDir } = fixture();
  assert.throws(() => resolveTrack('albums', { musicDir }), TrackError);
});

test('REJECTS any local path when no music directory is configured', () => {
  assert.throws(() => resolveTrack('song.mp3', { musicDir: null }), TrackError);
});

// ------------------------------------------------------------------ URLs

test('resolves an https URL', () => {
  const track = resolveTrack('https://example.com/stream.mp3', { musicDir: null });
  assert.equal(track.kind, 'url');
  assert.equal(track.url, 'https://example.com/stream.mp3');
});

test('resolves an http URL', () => {
  assert.equal(resolveTrack('http://example.com/a.mp3', { musicDir: null }).kind, 'url');
});

test('REJECTS file:// URLs', () => {
  assert.throws(
    () => resolveTrack('file:///etc/passwd', { musicDir: null }),
    TrackError,
    'ffmpeg would happily open this — same host-file exfiltration as traversal',
  );
});

test('REJECTS other schemes ffmpeg understands', () => {
  for (const input of ['ftp://h/a.mp3', 'rtmp://h/a', 'concat:/etc/passwd', 'data:audio/mp3;base64,AA']) {
    assert.throws(() => resolveTrack(input, { musicDir: null }), TrackError, `should reject ${input}`);
  }
});

test('rejects empty or whitespace input', () => {
  assert.throws(() => resolveTrack('', { musicDir: '/tmp' }), TrackError);
  assert.throws(() => resolveTrack('   ', { musicDir: '/tmp' }), TrackError);
});

test('a URL title is readable rather than the raw URL', () => {
  assert.equal(resolveTrack('https://example.com/music/track.mp3', { musicDir: null }).title, 'track.mp3');
});
