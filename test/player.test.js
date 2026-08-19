const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { createTrackStream, ffmpegPath } = require('../music/player.js');

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
