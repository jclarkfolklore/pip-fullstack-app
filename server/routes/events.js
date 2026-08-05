const express = require('express');
const { dataVersion } = require('../db');
const changeBus = require('../lib/changeBus');

const router = express.Router();

const POLL_MS = 600;

// Server-Sent Events: every open tab holds one of these. Two independent
// triggers, because neither alone is sufficient:
//
//  1. changeBus — published by server/index.js after any successful mutating
//     API request. This covers everything the UI itself does.
//  2. PRAGMA data_version poll — catches commits from OTHER connections, e.g.
//     Claude editing data/pip.sqlite directly with a separate script. SQLite
//     deliberately does NOT bump data_version for commits made on the same
//     connection, which is exactly why (1) is needed as well — without it,
//     nothing the UI did ever produced an event.
//
// Together they mean the frontend never has to be manually refreshed.
router.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Any buffering proxy in front of this would defeat the purpose.
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  let lastVersion = dataVersion();
  let closed = false;

  function send(event, data) {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {
      closed = true;
    }
  }

  send('connected', { version: lastVersion });

  // (1) immediate, for in-process writes
  const unsubscribe = changeBus.subscribe((detail) => {
    // Re-baseline so the poll doesn't re-announce this same change a moment
    // later as though it were a second, separate one.
    lastVersion = dataVersion();
    send('changed', { ...detail, version: lastVersion, via: 'api' });
  });

  // (2) polled, for external writes
  const interval = setInterval(() => {
    if (closed) return;
    const v = dataVersion();
    if (v !== lastVersion) {
      lastVersion = v;
      send('changed', { version: v, via: 'external' });
    } else {
      try {
        res.write(': ping\n\n');
      } catch (_) {
        closed = true;
      }
    }
  }, POLL_MS);

  req.on('close', () => {
    closed = true;
    clearInterval(interval);
    unsubscribe();
  });
});

module.exports = router;
