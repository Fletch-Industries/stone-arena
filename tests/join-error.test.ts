import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinError } from '../client/join-error.js';

const refusal = (code: number, message: string) => Object.assign(new Error(message), { code });

test('locked admission explains both capacity and competitive-round restrictions', () => {
  const message = joinError(refusal(522, 'room "PRIVATE123" is locked'));
  assert.match(message, /full or its round has started/);
  assert.match(message, /Refresh open arenas/);
  assert(!message.includes('PRIVATE123'));
});

test('missing and disposed rooms offer a code check without exposing room identifiers', () => {
  for (const ending of ['not found', 'has been disposed.']) {
    const message = joinError(refusal(522, `room "PRIVATE123" ${ending}`));
    assert.match(message, /no longer available.*Check the code.*refresh open arenas/);
    assert(!message.includes('PRIVATE123'));
  }
});

test('expired reconnect reservations explain how to return without promising a recovered connection', () => {
  assert.equal(joinError(refusal(524, 'reconnection token invalid or expired.')), 'Your return connection expired. Join the world or arena again.');
});

test('authored admission messages preserve break, storage, version, profile, tab and world-lease distinctions', () => {
  for (const [code, message] of [
    [429, 'Break time. Play again in 30 minutes.'],
    [429, 'Play-time storage unavailable. Try again shortly.'],
    [400, 'Please refresh to update the game.'],
    [400, 'Invalid player profile. Refresh the page.'],
    [409, 'This browser tab already has a seat. Return to the existing arena or close the duplicate tab. Abandoned connections expire within 30 seconds.'],
    [409, 'This world already has an arena. Rejoin it or wait until everyone leaves.'],
    [503, 'Arena is busy. Please try again shortly.'],
    [404, 'That online world could not be opened. Use a downloaded world file if you have one.'],
  ] as const) assert.equal(joinError(refusal(code, message)), message);
});

test('SDK copy requires the exact code and message shape; unrelated failures retain their meaning', () => {
  for (const error of [new Error('room "ABC" is locked'), refusal(409, 'room "ABC" is locked'), refusal(522, 'Private world locked'), refusal(524, 'Another reservation error')]) assert.equal(joinError(error), error.message);
  assert.equal(joinError(null), 'Could not connect. Check the room code and try again.');
});
