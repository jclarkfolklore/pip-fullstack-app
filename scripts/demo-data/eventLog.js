// Collects the planned activity_log history as seeding runs, so it can be
// written in one pass at the end (see retime.js) — the row dates and the
// history are derived from the same plan and so cannot disagree.
const { iso } = require('./timeline');

function createEventLog() {
  const events = [];

  function ev(entityType, entityId, eventType, when, detail = {}) {
    // A null `when` becomes new Date(null) — the epoch — which silently
    // stretched a real run's timeline back to 1970 and flattened every
    // chart's x-axis. Loud is better: callers decide what a missing date
    // means for their own kind of record (see e.g. seedTasks.js), and this
    // makes sure none of them can forget to.
    if (!when) throw new Error(`event ${eventType} on ${entityType} ${entityId} has no date`);
    events.push({ entityType, entityId, eventType, when: iso(when), detail });
  }

  return { ev, all: () => events };
}

module.exports = { createEventLog };
