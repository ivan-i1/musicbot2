const test = require('node:test');
const assert = require('node:assert/strict');

const { GuildQueue, QueueRegistry } = require('../music/queue.js');

const track = name => ({ kind: 'file', path: `/music/${name}`, title: name });

test('a new queue is empty and playing nothing', () => {
  const q = new GuildQueue();
  assert.equal(q.current, null);
  assert.deepEqual(q.upcoming, []);
  assert.equal(q.isEmpty, true);
});

test('the first track added becomes current with nothing ahead of it', () => {
  const q = new GuildQueue();
  const ahead = q.add(track('a.mp3'));

  assert.equal(ahead, 0, '0 tracks ahead means it starts immediately');
  assert.equal(q.current.title, 'a.mp3');
  assert.deepEqual(q.upcoming, []);
});

test('later tracks queue behind the current one', () => {
  const q = new GuildQueue();
  q.add(track('a.mp3'));

  assert.equal(q.add(track('b.mp3')), 1);
  assert.equal(q.add(track('c.mp3')), 2);
  assert.deepEqual(q.upcoming.map(t => t.title), ['b.mp3', 'c.mp3']);
});

test('next() promotes the head of the queue', () => {
  const q = new GuildQueue();
  q.add(track('a.mp3'));
  q.add(track('b.mp3'));

  assert.equal(q.next().title, 'b.mp3');
  assert.equal(q.current.title, 'b.mp3');
  assert.deepEqual(q.upcoming, []);
});

test('next() on an exhausted queue leaves nothing playing', () => {
  const q = new GuildQueue();
  q.add(track('a.mp3'));

  assert.equal(q.next(), null);
  assert.equal(q.current, null);
  assert.equal(q.isEmpty, true);
});

test('next() on an already-empty queue is harmless', () => {
  const q = new GuildQueue();
  assert.equal(q.next(), null);
});

test('stop() drops the current track and everything queued', () => {
  const q = new GuildQueue();
  q.add(track('a.mp3'));
  q.add(track('b.mp3'));
  q.stop();

  assert.equal(q.current, null);
  assert.deepEqual(q.upcoming, []);
});

test('clear() empties the queue but leaves the current track playing', () => {
  const q = new GuildQueue();
  q.add(track('a.mp3'));
  q.add(track('b.mp3'));
  const removed = q.clear();

  assert.equal(removed, 1);
  assert.equal(q.current.title, 'a.mp3', 'clearing the queue must not cut off the song playing');
  assert.deepEqual(q.upcoming, []);
});

test('upcoming is a copy — callers cannot mutate the queue through it', () => {
  const q = new GuildQueue();
  q.add(track('a.mp3'));
  q.add(track('b.mp3'));

  q.upcoming.push(track('injected.mp3'));
  assert.equal(q.upcoming.length, 1);
});

// -------------------------------------------------------------- registry

test('each guild gets its own queue', () => {
  const registry = new QueueRegistry();
  registry.for('guild-1').add(track('a.mp3'));

  assert.equal(registry.for('guild-2').current, null, 'queues must not leak between servers');
  assert.equal(registry.for('guild-1').current.title, 'a.mp3');
});

test('the same guild gets the same queue back', () => {
  const registry = new QueueRegistry();
  assert.equal(registry.for('guild-1'), registry.for('guild-1'));
});

test('a dropped guild queue is forgotten', () => {
  const registry = new QueueRegistry();
  registry.for('guild-1').add(track('a.mp3'));
  registry.drop('guild-1');

  assert.equal(registry.for('guild-1').current, null);
});
