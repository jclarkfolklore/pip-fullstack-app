const path = require('path');
const express = require('express');
const { DB_PATH } = require('./db');
const { startDropsWatcher, DROPS_DIR } = require('./dropsWatcher');

const PORT = Number(process.env.PIP_PORT) || 4288;
const HOST = '127.0.0.1'; // deliberately local-only — never bind 0.0.0.0

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use('/api/projects', require('./routes/projects'));
app.use('/api/inbox', require('./routes/inbox'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/journal', require('./routes/journal'));
app.use('/api/search', require('./routes/search'));
app.use('/api/metrics', require('./routes/metrics'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/widgets', require('./routes/widgets'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/export', require('./routes/export'));
app.use('/api/events', require('./routes/events'));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, dbPath: DB_PATH, dropsDir: DROPS_DIR });
});

// Static frontend build (webpack outputs here — see webpack.config.js).
const PUBLIC_DIR = path.resolve(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[pip] unhandled error:', err);
  res.status(500).json({ error: 'internal error' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[pip] serving on http://${HOST}:${PORT}`);
  console.log(`[pip] database: ${DB_PATH}`);
});

const stopDropsWatcher = startDropsWatcher();

function shutdown() {
  console.log('[pip] shutting down...');
  stopDropsWatcher();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
