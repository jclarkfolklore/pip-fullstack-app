// Clu3's decision layer: signals + rules -> one expression.
//
// Deliberately PURE — no database, no clock reads except what's passed in.
// That makes Clu3's behaviour reproducible and testable: give it a signals
// bag and you always get the same expression back. The composition (read DB,
// read tone, read pending message) happens in server/repo/clu3Repo.js.
//
// Adding a new observation belongs in rules.js, not here. This file should
// only change when the *mechanism* changes.

const { RULES } = require('./rules');

const TONE_RANK = { sparse: 0, balanced: 1, chatty: 2 };
const DEFAULT_TONE = 'balanced';

// At or above this, the top rule always wins outright. Overdue work and stale
// items are problems, not conversation topics — they don't take turns with
// small talk.
const URGENT_PRIORITY = 80;

// Below that, any rule within this many points of the leader is a fair
// candidate. Clu3 was picking strict argmax, so with (say) work completed
// today it said the same kind of thing every single poll while ten other
// perfectly true observations never got a turn.
const VARIETY_BAND = 25;

// Deterministic 0..1 from a seed. Keeps this file pure — the caller decides
// how much variation to ask for by varying `seed`, and the same seed always
// reproduces the same expression, which is what makes the engine testable.
function rand01(seed, salt) {
  let h = (Math.imul(seed | 0, 2654435761) ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function weightedPick(items, weightOf, roll) {
  const total = items.reduce((sum, it) => sum + weightOf(it), 0);
  if (total <= 0) return items[0];
  let r = roll * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function resolve(value, signals) {
  return typeof value === 'function' ? value(signals) : value;
}

function eligible(rule, tone) {
  const need = TONE_RANK[rule.minTone] ?? TONE_RANK.balanced;
  const have = TONE_RANK[tone] ?? TONE_RANK[DEFAULT_TONE];
  return have >= need;
}

// Which rule speaks. Every candidate's `when` is true, so any of them is
// honest — the only question is which true thing is worth saying right now.
//
// Urgent leaders win outright. Otherwise we sample among the leaders' band,
// weighted by priority squared so the most relevant observation still usually
// wins but isn't the ONLY thing Clu3 ever notices.
//
// rules.js ends with a priority-0 catch-all, so this should never come back
// empty — but we degrade gracefully if someone removes it.
function selectRule(signals, tone, seed = 0) {
  const candidates = RULES.filter((r) => eligible(r, tone))
    .filter((r) => {
      try {
        return Boolean(r.when(signals));
      } catch (err) {
        // A broken predicate shouldn't take Clu3 (or the panel) down.
        console.warn(`[clu3] rule "${r.id}" when() threw:`, err.message);
        return false;
      }
    })
    .sort((a, b) => b.priority - a.priority);

  if (!candidates.length) return null;

  const top = candidates[0];
  if (top.priority >= URGENT_PRIORITY) return top;

  const band = candidates.filter((r) => r.priority >= top.priority - VARIETY_BAND);
  return weightedPick(band, (r) => r.priority * r.priority, rand01(seed, 0x9e37));
}

// `avoid` holds lines said recently. Skipping them stops the same phrasing
// coming back twice in a row, which is what makes rotation actually read as
// rotation. If everything is excluded we ignore the list rather than fall
// silent.
function lineFor(rule, signals, seed = 0, avoid = []) {
  if (!rule.lines || !rule.lines.length) return '';

  const rendered = rule.lines
    .map((entry) => {
      try {
        return String(resolve(entry, signals) || '').trim();
      } catch (err) {
        console.warn(`[clu3] rule "${rule.id}" line threw:`, err.message);
        return '';
      }
    })
    .filter(Boolean);

  if (!rendered.length) return '';

  // Relax the exclusion rather than abandoning it. `avoid` spans every rule,
  // so it's routinely longer than one rule's handful of lines — excluding all
  // of them at once would leave nothing and fall back to the full pool, which
  // is how the same sentence ended up repeating several polls running. Try
  // fully-fresh first, then settle for "anything but the last thing said".
  let pool = rendered.filter((l) => !avoid.includes(l));
  if (!pool.length) pool = rendered.filter((l) => l !== avoid[0]);
  if (!pool.length) pool = rendered;

  return pool[Math.floor(rand01(seed, 0x85eb) * pool.length) % pool.length];
}

// An authored message (left by Claude via POST /api/clu3/messages) always
// outranks the rules engine — if we bothered to say something specific, that
// beats a generated observation.
function fromMessage(message, signals) {
  return {
    source: 'message',
    messageId: message.id,
    ruleId: null,
    mood: message.mood || 'content',
    line: message.body,
    action: message.action_kind ? { kind: message.action_kind, label: message.action_label || 'OPEN' } : null,
    energy: signals.energy,
    signals
  };
}

// `seed` is how the caller asks for variation: same seed, same expression
// (so this stays reproducible and testable); new seed on each poll, and Clu3
// says something different even when nothing about the workspace changed.
// `avoid` is the lines it has used recently.
function expression(
  signals,
  { tone = DEFAULT_TONE, pendingMessage = null, nowMs = Date.now(), seed = 0, avoid = [] } = {}
) {
  if (pendingMessage) return fromMessage(pendingMessage, signals);

  const rule = selectRule(signals, tone, seed);
  if (!rule) {
    return {
      source: 'fallback',
      messageId: null,
      ruleId: null,
      mood: 'content',
      line: 'Here and watching.',
      action: null,
      energy: signals.energy,
      signals
    };
  }

  return {
    source: 'rule',
    messageId: null,
    ruleId: rule.id,
    mood: resolve(rule.mood, signals) || 'content',
    line: lineFor(rule, signals, seed, avoid),
    action: rule.action || null,
    energy: signals.energy,
    signals
  };
}

module.exports = {
  expression,
  selectRule,
  lineFor,
  TONE_RANK,
  DEFAULT_TONE,
  URGENT_PRIORITY,
  VARIETY_BAND
};
