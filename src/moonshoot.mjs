export const MOON_DISTANCE_KM = 384_400;

const URLISH = /(?:https?:\/\/|www\.)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const HANDLE = /(^|\s)@[A-Za-z0-9_]{2,}/;
const BLOCKED = [
  /\b(?:kill|hurt)\s+(?:all|every)\b/i,
  /\b(?:nazi|kkk)\b/i,
];

export class MoonshootError extends Error {
  constructor(message, statusCode = 400, code = 'invalid_request') {
    super(message);
    this.name = 'MoonshootError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new MoonshootError('Invalid clock value.', 500, 'invalid_clock');
  return date.toISOString().slice(0, 10);
}

function priorDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setUTCDate(date.getUTCDate() - 1);
  return dayKey(date);
}

function cleanText(value, max, field, { required = false } = {}) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (required && !text) throw new MoonshootError(`${field} is required.`, 400, 'required');
  if (text.length > max) throw new MoonshootError(`${field} exceeds ${max} characters.`, 400, 'too_long');
  if (BLOCKED.some((rule) => rule.test(text))) throw new MoonshootError(`${field} was blocked by moderation.`, 422, 'moderation_block');
  return text;
}

function projectUrl(value) {
  const text = cleanText(value, 300, 'project.url');
  if (!text) return '';
  let parsed;
  try { parsed = new URL(text); } catch { throw new MoonshootError('project.url must be a valid HTTP(S) URL.', 400, 'invalid_url'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new MoonshootError('project.url must use HTTP(S).', 400, 'invalid_url');
  return parsed.toString();
}

function cleanMessage(value) {
  const text = cleanText(value, 120, 'message');
  if (text && (URLISH.test(text) || EMAIL.test(text) || PHONE.test(text) || HANDLE.test(text))) {
    throw new MoonshootError('message cannot contain links, handles, email addresses, or phone numbers.', 422, 'unsafe_message');
  }
  return text;
}

function cleanHandle(value) {
  const text = cleanText(value, 32, 'xHandle').replace(/^@/, '');
  if (text && !/^[A-Za-z0-9_]{1,15}$/.test(text)) throw new MoonshootError('xHandle is invalid.', 400, 'invalid_handle');
  return text;
}

function publicClaim(claim) {
  const { identityKey: _identityKey, ...safe } = claim;
  return structuredClone(safe);
}

function emptyState() {
  return {
    version: 'moonshoot-ledger/v1',
    sequence: 0,
    claims: [],
    fuel: [],
    updates: [],
    events: [],
    referralBonuses: {},
    reports: [],
  };
}

export function createMoonshootEngine({ clock = () => new Date(), initialState = null } = {}) {
  const state = initialState ? structuredClone(initialState) : emptyState();
  let queue = Promise.resolve();
  const serialize = (fn) => {
    const result = queue.then(fn, fn);
    queue = result.catch(() => undefined);
    return result;
  };

  function claimForIdentity(identityKey) {
    return state.claims.find((claim) => claim.identityKey === identityKey) || null;
  }

  function claimForKm(km) {
    return state.claims.find((claim) => claim.km === Number(km)) || null;
  }

  function creditBonus(identityKey, date, amount = 1) {
    if (!identityKey) return;
    const key = `${date}:${identityKey}`;
    state.referralBonuses[key] = (state.referralBonuses[key] || 0) + amount;
  }

  function dailyBudget(identityKey, date = dayKey(clock())) {
    return 1 + (state.referralBonuses[`${date}:${identityKey}`] || 0);
  }

  function fuelSpent(identityKey, date = dayKey(clock())) {
    return state.fuel.filter((entry) => entry.identityKey === identityKey && entry.day === date).length;
  }

  function validateIdentity(identityKey) {
    const value = cleanText(identityKey, 160, 'identityKey', { required: true });
    if (value.length < 6) throw new MoonshootError('identityKey is too short.', 400, 'weak_identity_key');
    return value;
  }

  async function claim(input = {}) {
    return serialize(() => {
      const identityKey = validateIdentity(input.identityKey);
      const existing = claimForIdentity(identityKey);
      if (existing) throw new MoonshootError('This verified identity already owns a kilometre.', 409, 'duplicate_identity');
      if (state.sequence >= MOON_DISTANCE_KM) throw new MoonshootError('All kilometres have been claimed.', 409, 'mission_complete');

      const name = cleanText(input.name, 40, 'name', { required: true });
      const country = cleanText(input.country, 56, 'country');
      const dedication = cleanText(input.dedication, 40, 'dedication');
      const message = cleanMessage(input.message);
      const xHandle = cleanHandle(input.xHandle);
      const project = input.project ? {
        name: cleanText(input.project.name, 40, 'project.name', { required: true }),
        url: projectUrl(input.project.url),
        stage: cleanText(input.project.stage, 80, 'project.stage'),
      } : null;
      if (!project && !dedication) throw new MoonshootError('Add either a project or a dedication.', 400, 'missing_payload');
      if (project && dedication) throw new MoonshootError('Choose a project or a dedication, not both.', 400, 'ambiguous_payload');

      let referrer = null;
      if (input.referrerKm != null && input.referrerKm !== '') {
        referrer = claimForKm(input.referrerKm);
        if (!referrer) throw new MoonshootError('referrerKm does not exist.', 400, 'invalid_referrer');
        if (referrer.identityKey === identityKey) throw new MoonshootError('Self-referrals are not allowed.', 400, 'self_referral');
      }

      const now = clock();
      const date = dayKey(now);
      const km = ++state.sequence;
      const record = {
        km,
        identityKey,
        name,
        country,
        dedication,
        message,
        xHandle,
        project,
        createdAt: now.toISOString(),
        referrerKm: referrer?.km || null,
      };
      state.claims.push(record);
      if (referrer) {
        creditBonus(identityKey, date, 1);
        creditBonus(referrer.identityKey, date, 1);
      }
      return publicClaim(record);
    });
  }

  async function giveFuel(input = {}) {
    return serialize(() => {
      const identityKey = validateIdentity(input.identityKey);
      const sender = claimForIdentity(identityKey);
      if (!sender) throw new MoonshootError('Only claimed identities can give Fuel.', 403, 'claim_required');
      const target = claimForKm(input.targetKm);
      if (!target) throw new MoonshootError('targetKm does not exist.', 404, 'missing_target');
      if (target.identityKey === identityKey) throw new MoonshootError('You cannot Fuel your own kilometre.', 400, 'self_fuel');
      const day = dayKey(clock());
      const budget = dailyBudget(identityKey, day);
      const spent = fuelSpent(identityKey, day);
      if (spent >= budget) throw new MoonshootError('Daily Fuel budget is exhausted.', 409, 'fuel_exhausted');
      const record = { identityKey, fromKm: sender.km, targetKm: target.km, day, createdAt: clock().toISOString() };
      state.fuel.push(record);
      return { targetKm: target.km, day, spent: spent + 1, remaining: budget - spent - 1 };
    });
  }

  async function postUpdate(input = {}) {
    return serialize(() => {
      const identityKey = validateIdentity(input.identityKey);
      const owner = claimForIdentity(identityKey);
      if (!owner?.project) throw new MoonshootError('A claimed project is required to post updates.', 403, 'project_required');
      const day = dayKey(clock());
      if (state.updates.some((entry) => entry.identityKey === identityKey && entry.day === day)) {
        throw new MoonshootError('Only one builder update is allowed per UTC day.', 409, 'daily_update_used');
      }
      const text = cleanText(input.text, 140, 'update', { required: true });
      if (URLISH.test(text) || EMAIL.test(text) || PHONE.test(text)) throw new MoonshootError('Update cannot contain contact details or links.', 422, 'unsafe_update');
      const record = { identityKey, km: owner.km, day, text, createdAt: clock().toISOString() };
      state.updates.push(record);
      return { km: owner.km, day, text, createdAt: record.createdAt };
    });
  }

  async function recordEvent(input = {}) {
    return serialize(() => {
      const type = cleanText(input.type, 32, 'type', { required: true });
      if (!['profile_view', 'outbound_click'].includes(type)) throw new MoonshootError('Unsupported event type.', 400, 'unsupported_event');
      const target = claimForKm(input.targetKm);
      if (!target) throw new MoonshootError('targetKm does not exist.', 404, 'missing_target');
      const actorKey = cleanText(input.actorKey, 160, 'actorKey', { required: true });
      const day = dayKey(clock());
      const fingerprint = `${day}:${type}:${target.km}:${actorKey}`;
      if (state.events.some((event) => event.fingerprint === fingerprint)) return { recorded: false, duplicate: true };
      state.events.push({ fingerprint, day, type, targetKm: target.km, createdAt: clock().toISOString() });
      return { recorded: true, duplicate: false };
    });
  }

  async function report(input = {}) {
    return serialize(() => {
      const identityKey = validateIdentity(input.identityKey);
      const reporter = claimForIdentity(identityKey);
      if (!reporter) throw new MoonshootError('Only claimed identities can report content.', 403, 'claim_required');
      const target = claimForKm(input.targetKm);
      if (!target) throw new MoonshootError('targetKm does not exist.', 404, 'missing_target');
      if (state.reports.some((entry) => entry.identityKey === identityKey && entry.targetKm === target.km)) {
        return { targetKm: target.km, reports: state.reports.filter((entry) => entry.targetKm === target.km).length, duplicate: true };
      }
      state.reports.push({ identityKey, targetKm: target.km, createdAt: clock().toISOString() });
      const count = state.reports.filter((entry) => entry.targetKm === target.km).length;
      return { targetKm: target.km, reports: count, hiddenPendingReview: count >= 3, duplicate: false };
    });
  }

  function cargo(forDay = dayKey(clock())) {
    const sourceDay = priorDay(`${forDay}T12:00:00Z`);
    const counts = new Map();
    for (const entry of state.fuel.filter((item) => item.day === sourceDay)) counts.set(entry.targetKm, (counts.get(entry.targetKm) || 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 3)
      .map(([km, fuel]) => ({ km, fuel, claim: publicClaim(claimForKm(km)) }));
  }

  function countryLeaderboard() {
    const counts = new Map();
    for (const claim of state.claims) if (claim.country) counts.set(claim.country, (counts.get(claim.country) || 0) + 1);
    return [...counts.entries()].map(([country, pushes]) => ({ country, pushes })).sort((a, b) => b.pushes - a.pushes || a.country.localeCompare(b.country));
  }

  function discoveryMetrics(km) {
    const targetKm = Number(km);
    const fuel = state.fuel.filter((entry) => entry.targetKm === targetKm).length;
    const profileViews = state.events.filter((entry) => entry.targetKm === targetKm && entry.type === 'profile_view').length;
    const outboundClicks = state.events.filter((entry) => entry.targetKm === targetKm && entry.type === 'outbound_click').length;
    return { km: targetKm, fuel, uniqueProfileViews: profileViews, uniqueOutboundClicks: outboundClicks };
  }

  function manifest() {
    return state.claims.map((claim) => {
      const latest = [...state.updates].reverse().find((entry) => entry.km === claim.km) || null;
      return { ...publicClaim(claim), latestUpdate: latest ? { day: latest.day, text: latest.text, createdAt: latest.createdAt } : null, metrics: discoveryMetrics(claim.km) };
    });
  }

  function snapshot() {
    return {
      version: state.version,
      moonDistanceKm: MOON_DISTANCE_KM,
      claimedKm: state.sequence,
      remainingKm: MOON_DISTANCE_KM - state.sequence,
      progressPercent: Number(((state.sequence / MOON_DISTANCE_KM) * 100).toFixed(6)),
      countries: countryLeaderboard(),
      cargo: cargo(),
      recentClaims: state.claims.slice(-20).reverse().map(publicClaim),
    };
  }

  return {
    claim,
    giveFuel,
    postUpdate,
    recordEvent,
    report,
    snapshot,
    manifest,
    cargo,
    countryLeaderboard,
    discoveryMetrics,
    dailyBudget,
    exportState: () => structuredClone(state),
  };
}

export const liveMoonshootEngine = globalThis.__MOONSHOOT_RE267_ENGINE__ || createMoonshootEngine();
globalThis.__MOONSHOOT_RE267_ENGINE__ = liveMoonshootEngine;
