// Fake weather for the demo panel, written straight into app_meta rather
// than fetched from Open-Meteo.
//
// WHY NOT JUST PICK A REAL CITY AND LET IT FETCH LIVE. Two reasons. First,
// consistency with everything else in this module: the whole demo is
// deterministic and offline (see rng.js, timeline.js) so a rebuild always
// produces the same workspace — a live API call breaks both properties, and
// makes seeding depend on network access it doesn't otherwise need. Second,
// a snapshot is frozen by definition (index.js turns off the panel's polling
// in static mode, same reasoning as Clu3's), so "live" weather in a demo
// would just be whatever happened to be true on the day it was built,
// silently going stale forever after. Inventing the forecast makes that
// explicit instead of accidental.
//
// The place name is invented too, not a real city — the point of the whole
// demo is that nothing in it is traceable to anything real, and a real city
// paired with fake everything else would be the one exception.
const { describe } = require('../../server/weather/codes');
const { iso } = require('./timeline');

const PLACE = 'Fictional Harbor, ZZ';
// Coordinates in the Atlantic, away from any real coastline — never handed
// to a real API, but chosen so they'd never resolve to a real place if they
// ever were.
const LAT = 31.0;
const LON = -40.0;

function seedWeather(ctx) {
  const { db, rng } = ctx;
  const { pick, int, chance } = rng;

  // A small, plausible run of codes rather than picking from the whole set —
  // three sunny days in a row followed by a storm is a real forecast shape;
  // fog then a heatwave then a blizzard is not.
  const RUNS = [
    [0, 1, 2],
    [2, 3, 61],
    [1, 0, 2],
    [3, 51, 63],
    [0, 2, 1]
  ];
  const run = pick(RUNS);
  const highBase = int(58, 82);

  const days = run.map((code, i) => {
    const { kind, label } = describe(code);
    const high = highBase + int(-4, 4) - i;
    return { date: null, code, kind, label, high, low: high - int(12, 20) };
  });
  // Dates are assigned after the fact so "today" always lines up with when
  // the snapshot is actually opened, not when it was built.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  days.forEach((d, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    d.date = date.toISOString().slice(0, 10);
  });

  const currentCode = days[0].code;
  const currentDesc = describe(currentCode);
  const current = {
    temp: days[0].high - int(2, 8),
    code: currentCode,
    kind: currentDesc.kind,
    label: currentDesc.label,
    observedAt: iso(new Date())
  };

  // One mild, clearly invented alert, so the counted-badge path in the panel
  // has something to show — most days genuinely have none, so this is the
  // minority case on purpose. Gated on the overnight low actually being cold
  // enough for a frost advisory to make sense; an 82F forecast citing frost
  // would be the kind of detail that gives a fake dataset away.
  const overnightLow = Math.min(...days.map((d) => d.low));
  const alerts = overnightLow >= 40 || chance(0.67) ? [] : [
    {
      id: 'demo-alert-1',
      event: 'Frost Advisory',
      severity: 'Minor',
      urgency: 'Expected',
      headline: 'Frost Advisory in effect from 11 PM this evening to 8 AM tomorrow',
      description: `Temperatures as low as ${overnightLow}F expected. Sensitive outdoor plants should be covered.`,
      instruction: 'Take precautions to protect tender plants from the cold.',
      areaDesc: PLACE,
      starts: iso(new Date()),
      ends: iso(new Date(Date.now() + 12 * 36e5))
    }
  ];

  const air = { aqi: int(18, 46), label: 'Good' };

  const payload = {
    place: PLACE,
    unit: 'fahrenheit',
    unitLabel: 'F',
    timezone: 'Etc/UTC',
    current,
    days,
    alerts,
    air,
    fetchedAt: iso(new Date())
  };

  const set = (key, value) => db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(key, value);
  set('weather_place', PLACE);
  set('weather_lat', String(LAT));
  set('weather_lon', String(LON));
  set('weather_unit', 'fahrenheit');
  set('weather_cache', JSON.stringify(payload));
}

module.exports = { seedWeather };
