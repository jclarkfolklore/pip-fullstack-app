// WMO weather interpretation codes -> our own art kinds + labels.
//
// Open-Meteo returns raw WMO codes (0-99). We collapse them into a small set
// of `kind` values that src/lib/weatherArt.js knows how to draw, so adding a
// new visual means adding a kind here and a grid there — nothing else.
//
// Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes)

const KINDS = ['clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'storm'];

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
  61: { kind: 'rain', label: 'Light rain' },
  63: { kind: 'rain', label: 'Rain' },
  65: { kind: 'rain', label: 'Heavy rain' },
  66: { kind: 'rain', label: 'Freezing rain' },
  67: { kind: 'rain', label: 'Freezing rain' },
  71: { kind: 'snow', label: 'Light snow' },
  73: { kind: 'snow', label: 'Snow' },
  75: { kind: 'snow', label: 'Heavy snow' },
  77: { kind: 'snow', label: 'Snow grains' },
  80: { kind: 'rain', label: 'Showers' },
  81: { kind: 'rain', label: 'Showers' },
  82: { kind: 'rain', label: 'Heavy showers' },
  85: { kind: 'snow', label: 'Snow showers' },
  86: { kind: 'snow', label: 'Snow showers' },
  95: { kind: 'storm', label: 'Thunderstorm' },
  96: { kind: 'storm', label: 'Storm, hail' },
  99: { kind: 'storm', label: 'Storm, hail' }
};

const UNKNOWN = { kind: 'cloudy', label: 'Unknown' };

function describe(code) {
  return CODE_MAP[code] || UNKNOWN;
}

module.exports = { describe, KINDS, CODE_MAP };
