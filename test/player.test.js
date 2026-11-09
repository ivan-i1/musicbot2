const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { EventEmitter } = require('node:events');

const { createTrackStream, ffmpegPath, watchFfmpegExit } = require('../music/player.js');

// The voice layer itself needs a live gateway, but the audio pipeline does
// not — these run real ffmpeg and assert on the real bytes it produces. This
// is the gate that catches "the bot connects but no sound comes out", which
// green unit tests on the queue alone would never notice.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'player-'));
const toneFile = path.join(dir, 'tone.mp3');

test('setup: ffmpeg-static binary is present and runnable', () => {
  assert.ok(ffmpegPath, 'ffmpeg-static did not resolve to a path');
  assert.ok(fs.existsSync(ffmpegPath), `no ffmpeg binary at ${ffmpegPath} — npm approve-scripts ffmpeg-static?`);

  execFileSync(ffmpegPath, [
    '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:a', 'libmp3lame', '-y', toneFile,
  ]);
  assert.ok(fs.statSync(toneFile).size > 0, 'failed to generate a test tone');
});

test('ffmpeg build supports libopus', () => {
  const encoders = execFileSync(ffmpegPath, ['-hide_banner', '-encoders']).toString();
  assert.match(encoders, /libopus/,
    'without libopus the pipeline falls back to PCM and then needs a native opus module');
});

test('a local file transcodes to a non-empty Ogg Opus stream', async () => {
  const chunks = [];
  const stream = createTrackStream({ kind: 'file', path: toneFile });

  await new Promise((resolve, reject) => {
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  const output = Buffer.concat(chunks);
  assert.ok(output.length > 0, 'ffmpeg produced no audio at all');
  assert.equal(output.subarray(0, 4).toString('ascii'), 'OggS',
    'output must be an Ogg container — StreamType.OggOpus depends on it');
  assert.ok(output.includes(Buffer.from('OpusHead')),
    'the Ogg stream must carry an Opus identification header');
});

test('rejects a track carrying neither a path nor a url', () => {
  assert.throws(() => createTrackStream({ kind: 'file' }), /neither a path nor a url/);
});

// --------------------------------------------------- ffmpeg argument rules

const { buildFfmpegArgs } = require('../music/player.js');

test('file inputs get NO reconnect options', () => {
  const args = buildFfmpegArgs({ kind: 'file', path: '/music/a.mp3' });
  assert.ok(!args.includes('-reconnect'),
    'ffmpeg rejects -reconnect for file inputs and exits before producing audio');
});

test('url inputs DO get reconnect options, before -i', () => {
  const args = buildFfmpegArgs({ kind: 'url', url: 'https://example.com/a.mp3' });
  assert.ok(args.includes('-reconnect'));
  assert.ok(args.indexOf('-reconnect') < args.indexOf('-i'),
    'input options are only honoured before the -i they apply to');
});

test('both kinds encode opus at the sample rate Discord requires', () => {
  for (const track of [{ kind: 'file', path: '/a.mp3' }, { kind: 'url', url: 'https://e.com/a.mp3' }]) {
    const args = buildFfmpegArgs(track);
    assert.ok(args.includes('libopus'));
    assert.equal(args[args.indexOf('-ar') + 1], '48000');
    assert.equal(args[args.indexOf('-ac') + 1], '2');
  }
});

// A dead ffmpeg looks exactly like a track that ended: the stream closes, the
// player goes Idle, the bot leaves. The exit status is the only difference.
function fakeProcess() {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

function logsFor(exit, stderr) {
  const lines = [];
  const proc = fakeProcess();
  watchFfmpegExit(proc, { title: 'song.mp3' }, line => lines.push(line));
  if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
  proc.emit('close', exit.code ?? null, exit.signal ?? null);
  return lines;
}

test('watchFfmpegExit reports a crash by signal', () => {
  const lines = logsFor({ signal: 'SIGSEGV' });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /SIGSEGV/);
  assert.match(lines[0], /song\.mp3/);
});

test('watchFfmpegExit reports a non-zero exit with what ffmpeg said', () => {
  const lines = logsFor({ code: 1 }, 'Server returned 404 Not Found\n');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /code 1/);
  assert.match(lines[0], /404 Not Found/);
});

test('watchFfmpegExit stays quiet on a clean finish', () => {
  assert.deepEqual(logsFor({ code: 0 }), []);
});

test('watchFfmpegExit stays quiet when the stream was killed on purpose', () => {
  // prism-media SIGKILLs ffmpeg when a track is skipped or stopped.
  assert.deepEqual(logsFor({ signal: 'SIGKILL' }), []);
});

test('createTrackStream logs when real ffmpeg fails', async t => {
  const error = t.mock.method(console, 'error', () => {});
  const stream = createTrackStream({ kind: 'file', path: path.join(dir, 'missing.mp3'), title: 'missing.mp3' });
  const proc = stream.process;
  stream.on('data', () => {});

  await new Promise(resolve => proc.once('close', resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(error.mock.callCount(), 1);
  assert.match(error.mock.calls[0].arguments[0], /missing\.mp3/);
});
