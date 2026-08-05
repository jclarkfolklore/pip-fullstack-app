// WMO weather interpretation codes -> our own art kinds + labels.
//
// Open-Meteo returns raw WMO codes (0-99). We collapse them into a small set
// of `kind` values that src/lib/weatherArt.js knows how to draw, so adding a
// new visual means adding a kind here and a grid there — nothing else.
//
// Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes)

// Rain and snow keep their three WMO intensity grades rather than collapsing
// to one kind each, and thunderstorms split by whether hail is falling — the
// difference between light rain and a downpour, or a storm and a hailstorm,
// is exactly what you want a glanceable icon to tell you.
const KINDS = [
  'clear',
  'partly',
  'cloudy',
  'fog',
  'drizzle',
  'rainLight',
  'rain',
  'rainHeavy',
  'snowLight',
  'snow',
  'snowHeavy',
  'storm',
  'hail'
];

const CODE_MAP = {
  0: { kind: 'clear', label: 'Clear' },
  1: { kind: 'clear', label: 'Mostly clear' },
  2: { kind: 'partly', label: 'Partly cloudy' },
  3: { kind: 'cloudy', label: 'Overcast' },
  45: { kind: 'fog', label: 'Fog' },
  48: { kind: 'fog', label: 'Icy fog' },
  51: { kind: 'drizzle', label: 'Light drizzle' },
  53: { kind: 'drizzle', label: 'Drizzle' },
  55: { kind: 'drizzle', label: 'Heavy drizzle' },
  56: { kind: 'drizzle', label: 'Freezing drizzle' },
  57: { kind: 'drizzle', label: 'Freezing drizzle' },
  61: { kind: 'rainLight', label: 'Light rain' },
  63: { kind: 'rain', label: 'Rain' },
  65: { kind: 'rainHeavy', label: 'Heavy rain' },
  // Freezing rain has no icon of its own — it borrows the matching intensity
  // and relies on the label to say "freezing". Worth splitting out if it ever
  // matters more than the intensity does.
  66: { kind: 'rainLight', label: 'Freezing rain' },
  67: { kind: 'rainHeavy', label: 'Freezing rain' },
  71: { kind: 'snowLight', label: 'Light snow' },
  73: { kind: 'snow', label: 'Snow' },
  75: { kind: 'snowHeavy', label: 'Heavy snow' },
  77: { kind: 'snowLight', label: 'Snow grains' },
  80: { kind: 'rainLight', label: 'Light showers' },
  81: { kind: 'rain', label: 'Showers' },
  82: { kind: 'rainHeavy', label: 'Violent showers' },
  85: { kind: 'snowLight', label: 'Light snow showers' },
  86: { kind: 'snowHeavy', label: 'Heavy snow showers' },
  95: { kind: 'storm', label: 'Thunderstorm' },
  96: { kind: 'hail', label: 'Storm, hail' },
  99: { kind: 'hail', label: 'Storm, heavy hail' }
};

const UNKNOWN = { kind: 'cloudy', label: 'Unknown' };

function describe(code) {
  return CODE_MAP[code] || UNKNOWN;
}

module.exports = { describe, KINDS, CODE_MAP };
