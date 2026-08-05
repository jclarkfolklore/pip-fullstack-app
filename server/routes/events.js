const express = require('express');
const { dataVersion } = require('../db');

const router = express.Router();

// Server-Sent Events: every open tab holds one of these. We poll SQLite's
// own PRAGMA data_version (bumped by ANY commit to the file, including
// Claude editing it directly with a separate script — completely outside
// this server process) and push a "changed" event whenever it moves. This
// is what makes the frontend refresh live even when the data changed out
// from under it.
router.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  let lastVersion = dataVersion();
  res.write(`event: connected\ndata: ${JSON.stringify({ version: lastVersion })}\n\n`);

  const interval = setInterval(() => {
    const v = dataVersion();
    if (v !== lastVersion) {
      lastVersion = v;
      res.write(`event: changed\ndata: ${JSON.stringify({ version: v })}\n\n`);
    } else {
      res.write(': ping\n\n');
    }
  }, 600);

  req.on('close', () => clearInterval(interval));
});

module.exports = router;
