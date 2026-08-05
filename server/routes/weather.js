const express = require('express');
const weather = require('../weather/service');

const router = express.Router();

// What the panel polls.
router.get('/', async (req, res) => {
  res.json(await weather.current());
});

router.get('/settings', (req, res) => {
  res.json(weather.getSettings());
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
