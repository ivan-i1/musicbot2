const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MailboxStore, isAvailable, becameAvailable } = require('../mailbox.js');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbox-'));
  return { file: path.join(dir, 'mailbox.json'), dir };
}

const clock = () => '2026-08-18T12:00:00.000Z';

// ---------------------------------------------------------------- store

test('a queued message is pending for its recipient', () => {
  const { file } = tmpStore();
  const store = new MailboxStore(file, clock);
  store.add('user-1', { fromTag: 'ivan#0001', message: 'hi' });

  const pending = store.pendingFor('user-1');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].message, 'hi');
  assert.equal(pending[0].fromTag, 'ivan#0001');
  assert.equal(pending[0].queuedAt, '2026-08-18T12:00:00.000Z');
});

test('messages for one recipient are invisible to another', () => {
  const { file } = tmpStore();
  const store = new MailboxStore(file, clock);
  store.add('user-1', { fromTag: 'a', message: 'hi' });

  assert.deepEqual(store.pendingFor('user-2'), []);
});

test('takeFor drains — a delivered message is never delivered twice', () => {
  const { file } = tmpStore();
  const store = new MailboxStore(file, clock);
  store.add('user-1', { fromTag: 'a', message: 'one' });
  store.add('user-1', { fromTag: 'b', message: 'two' });

  const first = store.takeFor('user-1');
  assert.equal(first.length, 2);
  assert.deepEqual(store.takeFor('user-1'), [], 'the queue must be empty after draining');
});

test('draining one recipient leaves another recipient untouched', () => {
  const { file } = tmpStore();
  const store = new MailboxStore(file, clock);
  store.add('user-1', { fromTag: 'a', message: 'one' });
  store.add('user-2', { fromTag: 'b', message: 'two' });

  store.takeFor('user-1');
  assert.equal(store.pendingFor('user-2').length, 1);
});

test('queued messages survive a restart', () => {
  const { file } = tmpStore();
  new MailboxStore(file, clock).add('user-1', { fromTag: 'a', message: 'persisted' });

  const reopened = new MailboxStore(file, clock);
  assert.equal(reopened.pendingFor('user-1')[0].message, 'persisted');
});

test('a drain is persisted, so a restart does not resurrect delivered mail', () => {
  const { file } = tmpStore();
  const store = new MailboxStore(file, clock);
  store.add('user-1', { fromTag: 'a', message: 'gone' });
  store.takeFor('user-1');

  assert.deepEqual(new MailboxStore(file, clock).pendingFor('user-1'), []);
});

test('a missing store file is an empty mailbox, not a crash', () => {
  const { file } = tmpStore();
  assert.deepEqual(new MailboxStore(file, clock).pendingFor('anyone'), []);
});

test('a corrupt store file is an empty mailbox, not a crash', () => {
  const { file } = tmpStore();
  fs.writeFileSync(file, 'this is not json{{{');

  let store;
  assert.doesNotThrow(() => { store = new MailboxStore(file, clock); });
  assert.deepEqual(store.pendingFor('anyone'), []);
});

test('recipientsWithMail lists only recipients that have mail', () => {
  const { file } = tmpStore();
  const store = new MailboxStore(file, clock);
  store.add('user-1', { fromTag: 'a', message: 'x' });
  store.add('user-2', { fromTag: 'b', message: 'y' });
  store.takeFor('user-1');

  assert.deepEqual(store.recipientsWithMail(), ['user-2']);
});

// ------------------------------------------------------------- presence

test('isAvailable is true for online, idle and dnd', () => {
  for (const status of ['online', 'idle', 'dnd']) {
    assert.equal(isAvailable({ status }), true, `${status} should count as reachable`);
  }
});

test('isAvailable is false for offline, invisible, and no presence at all', () => {
  assert.equal(isAvailable({ status: 'offline' }), false);
  assert.equal(isAvailable({ status: 'invisible' }), false);
  assert.equal(isAvailable(null), false, 'a user with no presence object is not known to be online');
  assert.equal(isAvailable(undefined), false);
});

test('coming online from offline counts as becoming available', () => {
  assert.equal(becameAvailable({ status: 'offline' }, { status: 'online' }), true);
});

test('an unknown previous presence plus an online new presence counts', () => {
  assert.equal(becameAvailable(null, { status: 'online' }), true,
    'after a bot restart the old presence is null; mail must still be delivered');
});

test('an already-available user changing status does NOT re-trigger delivery', () => {
  assert.equal(becameAvailable({ status: 'online' }, { status: 'idle' }), false);
  assert.equal(becameAvailable({ status: 'idle' }, { status: 'dnd' }), false);
});

test('going offline is not becoming available', () => {
  assert.equal(becameAvailable({ status: 'online' }, { status: 'offline' }), false);
  assert.equal(becameAvailable({ status: 'offline' }, { status: 'offline' }), false);
});
