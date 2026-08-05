const express = require('express');
const weather = require('../weather/service');
const { KINDS, CODE_MAP } = require('../weather/codes');

const router = express.Router();

// What the panel polls.
router.get('/', async (req, res) => {
  res.json(await weather.current());
});

// Every WMO code the upstream API can return, and the art kind it resolves
// to. Served rather than duplicated in the frontend so the preview is
// checking the REAL mapping — a client-side copy could drift and would then
// happily show a mapping that isn't the one in use.
router.get('/codes', (req, res) => {
  const byKind = {};
  for (const kind of KINDS) byKind[kind] = [];
  for (const [code, { kind, label }] of Object.entries(CODE_MAP)) {
    if (!byKind[kind]) byKind[kind] = [];
    byKind[kind].push({ code: Number(code), label });
  }
  for (const kind of Object.keys(byKind)) byKind[kind].sort((a, b) => a.code - b.code);
  res.json({ kinds: KINDS, byKind, total: Object.keys(CODE_MAP).length });
});

router.get('/settings', (req, res) => {
  res.json(weather.getSettings());
});

// Manual "get latest now" — bypasses the cache-freshness check and hits
// upstream immediately, regardless of how recently the last poll ran.
router.post('/refresh', async (req, res) => {
  try {
    await weather.refreshOnce();
  } catch (_) {
    /* current() below reports the failure */
  }
  res.json(await weather.current());
});

// City-name lookup for the Settings location picker.
router.get('/search', async (req, res) => {
  try {
    res.json(await weather.searchPlaces(req.query.q));
  } catch (err) {
    res.status(502).json({ error: `lookup failed: ${err.message}` });
  }
});

router.patch('/settings', async (req, res) => {
  const body = req.body || {};
  try {
    if (body.unit !== undefined) weather.setUnit(body.unit);
    if (body.lat !== undefined || body.lon !== undefined || body.place !== undefined) {
      weather.setLocation({ place: body.place, lat: body.lat, lon: body.lon });
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  // Pull fresh data immediately so the panel doesn't sit empty until the next
  // poll tick. A failure here is non-fatal — current() reports it.
  try {
    await weather.refreshOnce();
  } catch (_) {
    /* ignore */
  }
  res.json(await weather.current());
});

module.exports = router;
