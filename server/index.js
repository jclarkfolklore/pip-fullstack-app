const path = require('path');
const express = require('express');
const { db, DB_PATH } = require('./db');
const { startDropsWatcher, DROPS_DIR } = require('./dropsWatcher');
const { startWeatherPoller } = require('./weather/service');
const changeBus = require('./lib/changeBus');

const PORT = Number(process.env.PIP_PORT) || 4288;
const HOST = '127.0.0.1'; // deliberately local-only — never bind 0.0.0.0

const app = express();
// Must comfortably exceed attachmentsRepo's MAX_IMAGE_BYTES (8MB), because
// images arrive base64-encoded — which inflates them by ~4/3. An 8MB image is
// a ~10.7MB body, so 2MB here silently contradicted the documented image cap:
// anything over ~1.5MB was rejected by the body parser long before the repo's
// own size check ever ran.
app.use(express.json({ limit: '12mb' }));

// Broadcast a live-refresh to every open tab after any successful mutating API
// request. This is what makes the UI update without a manual reload: SQLite's
// PRAGMA data_version (polled in routes/events.js) is deliberately NOT bumped
// for commits on the same connection, so in-process writes are invisible to it.
// Hooked on 'finish' so we only announce changes that actually succeeded.
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
app.use((req, res, next) => {
  if (!MUTATING.has(req.method) || !req.path.startsWith('/api/')) return next();
  // Capture the path now — Express rewrites req.url to be router-relative once
  // the request enters a mounted router, so reading it in 'finish' gives '/'.
  const path = req.originalUrl.split('?')[0];
  const method = req.method;
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      changeBus.publish({ path, method });
    }
  });
  next();
});

app.use('/api/projects', require('./routes/projects'));
app.use('/api/inbox', require('./routes/inbox'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/journal', require('./routes/journal'));
app.use('/api/attachments', require('./routes/attachments'));
app.use('/api/clu3', require('./routes/clu3'));
app.use('/api/weather', require('./routes/weather'));
app.use('/api/search', require('./routes/search'));
app.use('/api/metrics', require('./routes/metrics'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/widgets', require('./routes/widgets'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/export', require('./routes/export'));
app.use('/api/events', require('./routes/events'));

app.get('/api/health', (req, res) => {
  // `demo` is stamped into the database by scripts/demo-data/index.js, so a
  // fictional workspace announces itself wherever it's served from. The
  // snapshot reads this to decide what its banner says — see pip-snapshot.js.
  const demo = db.prepare("SELECT value FROM app_meta WHERE key = 'demo_data'").get();
  res.json({ ok: true, dbPath: DB_PATH, dropsDir: DROPS_DIR, demo: demo?.value === '1' });
});

// Static frontend build (webpack outputs here — see webpack.config.js).
const PUBLIC_DIR = path.resolve(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, _next) => {
  // A payload that's too large is a client error with an obvious fix, not an
  // "internal error" — reporting it as 500 sent me hunting through server logs
  // for something the response could have just said.
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({
      error: `payload too large (${err.length} bytes, limit ${err.limit})`
    });
  }
  console.error('[pip] unhandled error:', err);
  res.status(500).json({ error: 'internal error' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[pip] serving on http://${HOST}:${PORT}`);
  console.log(`[pip] database: ${DB_PATH}`);
});

const stopDropsWatcher = startDropsWatcher();
// The demo pipeline (scripts/pip-snapshot-demo.js) sets this: scripts/demo-data
// seeds a fabricated forecast directly into app_meta specifically so nothing
// has to be fetched, but the poller ticks once immediately on startup
// regardless of cache freshness — left running, it would overwrite that fake,
// deterministic forecast with a real live one for made-up ocean coordinates on
// every snapshot build. A real server never sets this, so its behavior is
// unchanged.
const stopWeatherPoller = process.env.PIP_DISABLE_WEATHER_POLL === '1' ? () => {} : startWeatherPoller();

function shutdown() {
  console.log('[pip] shutting down...');
  stopDropsWatcher();
  stopWeatherPoller();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
