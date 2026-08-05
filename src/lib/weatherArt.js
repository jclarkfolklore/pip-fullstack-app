// Hand-authored 12x12 pixel weather art.
//
// Same philosophy as lib/icons.js and lib/faces.js: our own grids rendered as
// SVG rects, no icon pack and no emoji, so it sits inside the LCD theme
// instead of on top of it.
//
// Each kind is a list of LAYERS. A layer is { grid, tone, motion } where:
//   tone   'ink' (foreground) | 'dim' (background mass, e.g. cloud body)
//   motion undefined | 'fall' | 'drift' | 'pulse' | 'flash'
// Motion becomes a CSS class and is animated in styles/device.css — keeping
// the movement in CSS means it costs nothing per frame in JS.
//
// The `kind` values come from server/weather/codes.js. To add a condition:
// add a kind there, add an entry here. Nothing else changes.

const ON = '#';
const SVG_NS = 'http://www.w3.org/2000/svg';

// prettier-ignore
const SUN_DISC = [
  '............',
  '............',
  '............',
  '...######...',
  '..########..',
  '..########..',
  '..########..',
  '..########..',
  '...######...',
  '............',
  '............',
  '............'
];

// prettier-ignore
const SUN_RAYS = [
  '.....##.....',
  '............',
  '#..........#',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '#..........#',
  '............',
  '.....##.....'
];

// prettier-ignore
const CLOUD = [
  '............',
  '............',
  '....####....',
  '..########..',
  '.##########.',
  '############',
  '.##########.',
  '............',
  '............',
  '............',
  '............',
  '............'
];

// A smaller cloud tucked bottom-left, so a sun can peek out top-right.
// prettier-ignore
const CLOUD_SMALL = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '...###......',
  '..#####.....',
  '.########...',
  '.########...',
  '..######....',
  '............',
  '............'
];

// prettier-ignore
const SUN_CORNER = [
  '.........##.',
  '........####',
  '.........##.',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............'
];

// prettier-ignore
const RAIN_DROPS = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '..#...#...#.',
  '..#...#...#.',
  '............',
  '.#...#...#..',
  '.#...#...#..'
];

// prettier-ignore
const DRIZZLE_DROPS = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '..#...#...#.',
  '............',
  '.#...#...#..',
  '............',
  '...#...#....'
];

// prettier-ignore
const SNOW_FLAKES = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '..#...#...#.',
  '............',
  '.....#...#..',
  '..#.........',
  '.....#...#..'
];

// prettier-ignore
const BOLT = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '.....##.....',
  '....##......',
  '...#####....',
  '.....##.....',
  '....##......'
];

// prettier-ignore
const FOG_BARS = [
  '............',
  '............',
  '.##########.',
  '............',
  '############',
  '............',
  '.##########.',
  '............',
  '###########.',
  '............',
  '.#########..',
  '............'
];

const KIND_LAYERS = {
  clear: [
    { grid: SUN_RAYS, tone: 'ink', motion: 'pulse' },
    { grid: SUN_DISC, tone: 'ink' }
  ],
  partly: [
    { grid: SUN_CORNER, tone: 'ink', motion: 'pulse' },
    { grid: CLOUD_SMALL, tone: 'dim' }
  ],
  cloudy: [
    { grid: CLOUD, tone: 'dim' },
    { grid: CLOUD_SMALL, tone: 'ink', motion: 'drift' }
  ],
  fog: [{ grid: FOG_BARS, tone: 'dim', motion: 'drift' }],
  drizzle: [
    { grid: CLOUD, tone: 'dim' },
    { grid: DRIZZLE_DROPS, tone: 'ink', motion: 'fall' }
  ],
  rain: [
    { grid: CLOUD, tone: 'dim' },
    { grid: RAIN_DROPS, tone: 'ink', motion: 'fall' }
  ],
  snow: [
    { grid: CLOUD, tone: 'dim' },
    { grid: SNOW_FLAKES, tone: 'ink', motion: 'fall-slow' }
  ],
  storm: [
    { grid: CLOUD, tone: 'dim' },
    { grid: BOLT, tone: 'ink', motion: 'flash' }
  ]
};

export const WEATHER_KINDS = Object.keys(KIND_LAYERS);

function rect(x, y, className) {
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', '1');
  r.setAttribute('height', '1');
  r.setAttribute('class', className);
  return r;
}

export function renderWeatherArt(kind, { className = '' } = {}) {
  const layers = KIND_LAYERS[kind] || KIND_LAYERS.cloudy;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `pip-wx-art ${className}`.trim());

  for (const layer of layers) {
    const g = document.createElementNS(SVG_NS, 'g');
    const motion = layer.motion ? ` pip-wx-${layer.motion}` : '';
    g.setAttribute('class', `pip-wx-${layer.tone}${motion}`);
    layer.grid.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] === ON) g.appendChild(rect(x, y, ''));
      }
    });
    svg.appendChild(g);
  }

  return svg;
}
