#!/usr/bin/env node
//
// Clu3's workday pulse.
//
// Runs on a schedule (see scripts/com.folklore.clu3-pulse.plist) a few times
// across the working day, scans the workspace, and — only if there's something
// worth saying — leaves Clu3 an authored message.
//
// Why a local script rather than a cloud routine: the PIP server binds
// 127.0.0.1 only, so nothing off this machine can reach the API. Why not an
// LLM: this needs to be cheap, offline-safe, and deterministic.
//
// This is NOT a static list of canned lines. It reads the live signal bag from
// GET /api/clu3 and synthesises a cross-cutting digest — the kind of "here's
// the shape of your day" summary a single rule can't express, because rules
// each speak to one condition while this weighs everything at once.
//
// It deliberately stays quiet when the day is genuinely unremarkable. A
// companion that speaks up every two hours regardless becomes wallpaper.

const BASE = process.env.PIP_BASE_URL || 'http://127.0.0.1:4288';

// Messages expire before the next scheduled run, so a stale digest never
// lingers on screen.
const TTL_MINUTES = 115;

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Weighs everything at once and returns the single most useful thing to say,
// or null to stay quiet. Ordering here is the "algorithm": urgency first, then
// friction, then load, then encouragement.
function composePulse(s) {
  const parts = [];
  if (s.tasks.overdue > 0) parts.push(`${s.tasks.overdue} overdue`);
  if (s.inbox.staleCount > 0) parts.push(`${s.inbox.staleCount} aging`);
  if (s.inbox.new > 0) parts.push(`${s.inbox.new} new`);
  if (s.tasks.doing > 0) parts.push(`${s.tasks.doing} in progress`);

  // --- something needs attention ---
  if (s.tasks.overdue > 0) {
    const lead = s.tasks.oldestOverdue
      ? `"${s.tasks.oldestOverdue.title}" is ${plural(s.tasks.oldestOverdue.days, 'day', 'days')} past due.`
      : `${plural(s.tasks.overdue, 'task is', 'tasks are')} past due.`;
    return {
      body: `${lead} ${parts.join(' · ')}`.trim(),
      mood: s.tasks.overdue >= 3 ? 'alarmed' : 'concerned',
      actionKind: 'tasks',
      actionLabel: 'TASKS'
    };
  }

  if (s.inbox.staleCount > 0) {
    const lead = s.inbox.oldestStale
      ? `"${s.inbox.oldestStale.title}" has sat ${s.inbox.oldestStale.days}d.`
      : `${plural(s.inbox.staleCount, 'item is', 'items are')} going stale.`;
    return {
      body: `${lead} ${parts.join(' · ')}`.trim(),
      mood: 'concerned',
      actionKind: 'inbox',
      actionLabel: 'INBOX'
    };
  }

  // --- a real pile-up worth flagging ---
  if (s.inbox.new >= 3) {
    return {
      body: `Inbox is stacking up — ${parts.join(' · ')}.`,
      mood: 'busy',
      actionKind: 'inbox',
      actionLabel: 'INBOX'
    };
  }

  // --- worth acknowledging ---
  if (s.wins.today >= 2) {
    return {
      body: `${plural(s.wins.today, 'thing', 'things')} cleared today${s.wins.streak >= 2 ? `, ${s.wins.streak} days running` : ''}.`,
      mood: 'proud',
      actionKind: 'metrics',
      actionLabel: 'METRICS'
    };
  }

  // Mid-afternoon and the record is thin — a light, once-a-day sort of nudge.
  if (s.journal.total > 0 && s.journal.daysSinceLast !== null && s.journal.daysSinceLast >= 3 && s.hour >= 15) {
    return {
      body: `Journal's been quiet ${s.journal.daysSinceLast} days. Worth a line?`,
      mood: 'curious',
      actionKind: 'journal',
      actionLabel: 'JOURNAL'
    };
  }

  // Nothing notable — say nothing, and let the rules engine carry the panel.
  return null;
}

async function main() {
  const state = await api('/api/clu3');
  const pulse = composePulse(state.signals);

  if (!pulse) {
    console.log('[clu3-pulse] nothing worth saying; staying quiet');
    return;
  }

  // Clear any previous pulse so they don't stack up behind each other.
  const existing = await api('/api/clu3/messages');
  for (const m of existing) {
    await api(`/api/clu3/messages/${m.id}`, { method: 'DELETE' });
  }

  await api('/api/clu3/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...pulse, ttlMinutes: TTL_MINUTES })
  });
  console.log(`[clu3-pulse] posted (${pulse.mood}): ${pulse.body}`);
}

main().catch((err) => {
  // A failed pulse must never be noisy or fatal — the panel keeps working off
  // the rules engine regardless.
  console.warn('[clu3-pulse] skipped:', err.message);
  process.exit(0);
});
