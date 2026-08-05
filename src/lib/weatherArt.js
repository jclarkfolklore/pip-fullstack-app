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

// Cardinal rays. Two pixels thick — at one pixel they read as stray specks
// rather than light, especially once the disc is animating.
// prettier-ignore
const SUN_RAYS = [
  '.....##.....',
  '.....##.....',
  '............',
  '............',
  '............',
  '##........##',
  '##........##',
  '............',
  '............',
  '............',
  '.....##.....',
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

// Diagonal rays, alternated against SUN_RAYS so the sun shimmers rather than
// breathing as one block.
// prettier-ignore
const SUN_RAYS_DIAG = [
  '............',
  '.##......##.',
  '.##......##.',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '.##......##.',
  '.##......##.',
  '............'
];

// A second, higher cloud so overcast has depth and parallax.
// prettier-ignore
const CLOUD_BACK = [
  '............',
  '..#####.....',
  '.#######....',
  '.#######....',
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

// Second precipitation pass, sitting between the first's rows. Animated on the
// same keyframes but delayed by half a cycle, so as one set fades out the
// other is already falling — continuous rain instead of one sheet sliding
// down and resetting.
// prettier-ignore
const RAIN_DROPS_B = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '....#...#...',
  '....#...#...',
  '............',
  '...#...#...#',
  '...#...#...#'
];

// prettier-ignore
const DRIZZLE_DROPS_B = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '.....#...#..',
  '............',
  '...#...#....',
  '............',
  '.#...#......'
];

// prettier-ignore
const SNOW_FLAKES_B = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '.....#...#..',
  '............',
  '..#...#.....',
  '............',
  '...#...#....'
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

// Each kind's layers, back to front. Where two layers share a motion, the
// `-late` variant is the same animation on a delay — that offset is what makes
// precipitation continuous and the sun shimmer instead of throb.
// Each kind's layers, back to front.
//
// EVERY layer moves. A single static element in an otherwise animated icon
// reads as broken rather than calm, so even the "still" masses get something:
// clouds drift, the sun disc breathes. Where two layers share a motion, the
// `-late` variant is the same animation on a delay — that offset is what makes
// precipitation continuous and the sun shimmer instead of throb.
const KIND_LAYERS = {
  clear: [
    { grid: SUN_RAYS, tone: 'ink', motion: 'pulse' },
    { grid: SUN_RAYS_DIAG, tone: 'ink', motion: 'pulse-late' },
    { grid: SUN_DISC, tone: 'ink', motion: 'breathe' }
  ],
  partly: [
    { grid: SUN_CORNER, tone: 'ink', motion: 'pulse' },
    { grid: CLOUD_SMALL, tone: 'dim', motion: 'drift-slow' }
  ],
  cloudy: [
    { grid: CLOUD_BACK, tone: 'dim', motion: 'drift-slow' },
    { grid: CLOUD, tone: 'dim', motion: 'drift' },
    { grid: CLOUD_SMALL, tone: 'ink', motion: 'drift-late' }
  ],
  fog: [
    { grid: FOG_BARS, tone: 'dim', motion: 'drift' },
    { grid: CLOUD_BACK, tone: 'faint', motion: 'drift-slow' }
  ],
  drizzle: [
    { grid: CLOUD, tone: 'dim', motion: 'drift-slow' },
    { grid: DRIZZLE_DROPS, tone: 'ink', motion: 'fall-slow' },
    { grid: DRIZZLE_DROPS_B, tone: 'ink', motion: 'fall-slow-late' }
  ],
  rain: [
    { grid: CLOUD, tone: 'dim', motion: 'drift-slow' },
    { grid: RAIN_DROPS, tone: 'ink', motion: 'fall' },
    { grid: RAIN_DROPS_B, tone: 'ink', motion: 'fall-late' }
  ],
  snow: [
    { grid: CLOUD, tone: 'dim', motion: 'drift-slow' },
    { grid: SNOW_FLAKES, tone: 'ink', motion: 'fall-slow' },
    { grid: SNOW_FLAKES_B, tone: 'ink', motion: 'fall-slow-late' }
  ],
  storm: [
    { grid: CLOUD, tone: 'dim', motion: 'drift' },
    { grid: RAIN_DROPS, tone: 'dim', motion: 'fall' },
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
