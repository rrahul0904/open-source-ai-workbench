import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoonshootEngine, MOON_DISTANCE_KM } from '../src/moonshoot.mjs';

const identity = (n) => `verified-user-${n}`;
const project = (n) => ({ name: `Project ${n}`, url: `https://example.com/p${n}`, stage: 'building' });

function fixedClock(start = '2026-10-01T12:00:00Z') {
  let current = new Date(start);
  return { now: () => new Date(current), set: (value) => { current = new Date(value); } };
}

test('parallel claims are serialized into unique, monotonic kilometres', async () => {
  const engine = createMoonshootEngine();
  const claims = await Promise.all(Array.from({ length: 40 }, (_, i) => engine.claim({ identityKey: identity(i), name: `Builder ${i}`, project: project(i), country: i % 2 ? 'US' : 'IN' })));
  assert.deepEqual(claims.map((c) => c.km).sort((a,b) => a-b), Array.from({ length: 40 }, (_, i) => i + 1));
  assert.equal(engine.snapshot().claimedKm, 40);
  assert.equal(engine.snapshot().remainingKm, MOON_DISTANCE_KM - 40);
});

test('one verified identity can claim only once', async () => {
  const engine = createMoonshootEngine();
  await engine.claim({ identityKey: identity(1), name: 'A', dedication: 'For builders' });
  await assert.rejects(() => engine.claim({ identityKey: identity(1), name: 'Again', dedication: 'Again' }), (error) => error.code === 'duplicate_identity');
});

test('content is blocked before publication and message cannot smuggle contact details', async () => {
  const engine = createMoonshootEngine();
  await assert.rejects(() => engine.claim({ identityKey: identity(2), name: 'A', dedication: 'nazi club' }), (error) => error.code === 'moderation_block');
  await assert.rejects(() => engine.claim({ identityKey: identity(3), name: 'B', dedication: 'hello', message: 'visit https://spam.test' }), (error) => error.code === 'unsafe_message');
});

test('project and dedication are mutually exclusive', async () => {
  const engine = createMoonshootEngine();
  await assert.rejects(() => engine.claim({ identityKey: identity(4), name: 'C', dedication: 'Both', project: project(4) }), (error) => error.code === 'ambiguous_payload');
});

test('Fuel cannot be self-given, is budgeted daily, and referrals award same-day bonus', async () => {
  const clock = fixedClock();
  const engine = createMoonshootEngine({ clock: clock.now });
  const a = await engine.claim({ identityKey: identity(10), name: 'A', project: project(10), country: 'US' });
  const b = await engine.claim({ identityKey: identity(11), name: 'B', project: project(11), referrerKm: a.km, country: 'CA' });
  assert.equal(engine.dailyBudget(identity(10)), 2);
  assert.equal(engine.dailyBudget(identity(11)), 2);
  await assert.rejects(() => engine.giveFuel({ identityKey: identity(10), targetKm: a.km }), (error) => error.code === 'self_fuel');
  await engine.giveFuel({ identityKey: identity(10), targetKm: b.km });
  await engine.giveFuel({ identityKey: identity(10), targetKm: b.km });
  await assert.rejects(() => engine.giveFuel({ identityKey: identity(10), targetKm: b.km }), (error) => error.code === 'fuel_exhausted');
});

test('previous-day Fuel produces deterministic top-three cargo', async () => {
  const clock = fixedClock();
  const engine = createMoonshootEngine({ clock: clock.now });
  const claims = [];
  for (let i = 20; i < 25; i++) claims.push(await engine.claim({ identityKey: identity(i), name: `B${i}`, project: project(i) }));
  await engine.giveFuel({ identityKey: identity(20), targetKm: claims[1].km });
  await engine.giveFuel({ identityKey: identity(21), targetKm: claims[2].km });
  await engine.giveFuel({ identityKey: identity(23), targetKm: claims[2].km });
  await engine.giveFuel({ identityKey: identity(24), targetKm: claims[3].km });
  clock.set('2026-10-02T12:00:00Z');
  assert.deepEqual(engine.cargo().map((c) => [c.km, c.fuel]), [[claims[2].km, 2], [claims[1].km, 1], [claims[3].km, 1]]);
});

test('country leaderboard and daily builder update rules are deterministic', async () => {
  const clock = fixedClock();
  const engine = createMoonshootEngine({ clock: clock.now });
  await engine.claim({ identityKey: identity(30), name: 'A', project: project(30), country: 'US' });
  await engine.claim({ identityKey: identity(31), name: 'B', project: project(31), country: 'US' });
  await engine.claim({ identityKey: identity(32), name: 'C', project: project(32), country: 'IN' });
  assert.deepEqual(engine.countryLeaderboard(), [{ country: 'US', pushes: 2 }, { country: 'IN', pushes: 1 }]);
  await engine.postUpdate({ identityKey: identity(30), text: 'Shipped onboarding.' });
  await assert.rejects(() => engine.postUpdate({ identityKey: identity(30), text: 'Second update.' }), (error) => error.code === 'daily_update_used');
  clock.set('2026-10-02T12:00:00Z');
  const next = await engine.postUpdate({ identityKey: identity(30), text: 'Added analytics.' });
  assert.equal(next.day, '2026-10-02');
});

test('value metrics are distinct from Fuel and duplicate events are ignored', async () => {
  const engine = createMoonshootEngine();
  const target = await engine.claim({ identityKey: identity(40), name: 'Target', project: project(40) });
  await engine.claim({ identityKey: identity(41), name: 'Visitor', project: project(41) });
  await engine.giveFuel({ identityKey: identity(41), targetKm: target.km });
  assert.equal((await engine.recordEvent({ actorKey: 'browser-1', targetKm: target.km, type: 'profile_view' })).recorded, true);
  assert.equal((await engine.recordEvent({ actorKey: 'browser-1', targetKm: target.km, type: 'profile_view' })).duplicate, true);
  await engine.recordEvent({ actorKey: 'browser-1', targetKm: target.km, type: 'outbound_click' });
  assert.deepEqual(engine.discoveryMetrics(target.km), { km: target.km, fuel: 1, uniqueProfileViews: 1, uniqueOutboundClicks: 1 });
});

test('three unique participant reports trigger review hiding', async () => {
  const engine = createMoonshootEngine();
  const target = await engine.claim({ identityKey: identity(50), name: 'Target', dedication: 'hello' });
  for (let i = 51; i <= 53; i++) await engine.claim({ identityKey: identity(i), name: `R${i}`, dedication: 'hello' });
  assert.equal((await engine.report({ identityKey: identity(51), targetKm: target.km })).hiddenPendingReview, false);
  assert.equal((await engine.report({ identityKey: identity(52), targetKm: target.km })).hiddenPendingReview, false);
  assert.equal((await engine.report({ identityKey: identity(53), targetKm: target.km })).hiddenPendingReview, true);
});
