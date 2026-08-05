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

// How long a given line stays on screen before rotating to the next variant.
// Long enough to read and not flicker on every SSE refresh, short enough that
// Clu3 feels alive rather than frozen.
const ROTATE_MS = 45000;

// Cheap stable hash so rules don't all rotate their lines in lockstep.
function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function resolve(value, signals) {
  return typeof value === 'function' ? value(signals) : value;
}

function eligible(rule, tone) {
  const need = TONE_RANK[rule.minTone] ?? TONE_RANK.balanced;
  const have = TONE_RANK[tone] ?? TONE_RANK[DEFAULT_TONE];
  return have >= need;
}

// Highest-priority rule whose `when` matches and whose minTone the current
// tone setting allows. rules.js ends with a priority-0 catch-all, so this
// should never come back empty — but we degrade gracefully if someone
// removes it.
function selectRule(signals, tone) {
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
  return candidates[0] || null;
}

function lineFor(rule, signals, nowMs) {
  if (!rule.lines || !rule.lines.length) return '';
  const bucket = Math.floor(nowMs / ROTATE_MS) + hashId(rule.id);
  const entry = rule.lines[bucket % rule.lines.length];
  try {
    return String(resolve(entry, signals) || '').trim();
  } catch (err) {
    console.warn(`[clu3] rule "${rule.id}" line threw:`, err.message);
    return '';
  }
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

function expression(signals, { tone = DEFAULT_TONE, pendingMessage = null, nowMs = Date.now() } = {}) {
  if (pendingMessage) return fromMessage(pendingMessage, signals);

  const rule = selectRule(signals, tone);
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
    line: lineFor(rule, signals, nowMs),
    action: rule.action || null,
    energy: signals.energy,
    signals
  };
}

module.exports = { expression, selectRule, lineFor, TONE_RANK, DEFAULT_TONE, ROTATE_MS };
