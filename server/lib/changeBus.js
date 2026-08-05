// In-process change notifications.
//
// Why this exists: SQLite's PRAGMA data_version — which routes/events.js polls
// — is only bumped by commits made on OTHER connections. Per SQLite's docs it
// is deliberately unchanged for commits on the same connection. So the poll
// catches Claude editing the .sqlite file from a separate script, but never
// catches a mutation made through this server's own API, which is everything
// the UI does.
//
// This bus covers that second case: routes publish after a successful write,
// SSE clients subscribe, and the poll stays for genuinely external edits.

const subscribers = new Set();

function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function publish(detail = {}) {
  for (const fn of subscribers) {
    try {
      fn(detail);
    } catch (err) {
      // One broken subscriber (e.g. a half-closed response) must not stop the
      // others from being notified.
      console.warn('[pip] change subscriber failed:', err.message);
    }
  }
}

module.exports = { subscribe, publish, subscriberCount: () => subscribers.size };
