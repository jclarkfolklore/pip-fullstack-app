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

// Flakes are plus-shaped, not dots. Rain and snow at 1px are the same mark —
// the only thing separating them is speed, which you can't see in a still
// frame and barely see in motion. A 3x3 cross reads as snow instantly.
// prettier-ignore
const SNOW_FLAKES = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '...#....#...',
  '..###..###..',
  '...#....#...',
  '............',
  '............',
  '............'
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
  '............',
  '......#.....',
  '.....###....',
  '......#.....',
  '............'
];

// --- intensity variants. Light/heavy differ by DENSITY and streak length,
// not just speed, so the three grades are distinguishable in a still frame
// and not only when you watch them move. ---

// prettier-ignore
const RAIN_LIGHT = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '...#....#...',
  '...#....#...',
  '............',
  '............',
  '............'
];

// prettier-ignore
const RAIN_LIGHT_B = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '.....#......',
  '.....#......',
  '............'
];

// prettier-ignore
const RAIN_HEAVY = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '.#..#..#..#.',
  '.#..#..#..#.',
  '.#..#..#..#.',
  '............',
  '............',
  '............'
];

// prettier-ignore
const RAIN_HEAVY_B = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '#..#..#..#..',
  '#..#..#..#..',
  '#..#..#..#..',
  '............'
];

// prettier-ignore
const SNOW_LIGHT = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '.....#......',
  '....###.....',
  '.....#......',
  '............',
  '............'
];

// prettier-ignore
const SNOW_LIGHT_B = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '..#.........',
  '.###........',
  '..#.........'
];

// prettier-ignore
const SNOW_HEAVY = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '.#...#...#..',
  '###.###.###.',
  '.#...#...#..',
  '............',
  '............',
  '............',
  '............'
];

// prettier-ignore
const SNOW_HEAVY_B = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '..#...#...#.',
  '.###.###.###',
  '..#...#...#.',
  '............'
];

// Hail is drawn as 2x2 pellets rather than 1px streaks — chunky and bouncing,
// so a hailstorm never gets mistaken for a rainstorm at a glance.
// prettier-ignore
const HAIL_STONES = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '.##...##....',
  '.##...##....',
  '............',
  '....##...##.',
  '....##...##.'
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

// Fog is two interleaved sets of bars rather than one grid, so they can slide
// in OPPOSITE directions — a single grid can only shift as a block, which is
// what made fog read as static. Both are inset from the edges so the travel
// doesn't clip against the viewBox.
// prettier-ignore
const FOG_BARS_A = [
  '............',
  '............',
  '..########..',
  '............',
  '............',
  '............',
  '...######...',
  '............',
  '............',
  '............',
  '..#######...',
  '............'
];

// prettier-ignore
const FOG_BARS_B = [
  '............',
  '............',
  '............',
  '............',
  '.#########..',
  '............',
  '............',
  '............',
  '...#######..',
  '............',
  '............',
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
  // The two ray sets alternate hard (near-invisible to full) rather than both
  // fading gently, which reads as the sun turning.
  clear: [
    { grid: SUN_RAYS, tone: 'ink', motion: 'blink' },
    { grid: SUN_RAYS_DIAG, tone: 'ink', motion: 'blink-late' },
    { grid: SUN_DISC, tone: 'ink', motion: 'breathe' }
  ],
  partly: [
    { grid: SUN_CORNER, tone: 'ink', motion: 'blink' },
    { grid: CLOUD_SMALL, tone: 'dim', motion: 'drift' }
  ],
  // The main cloud BOBS rather than drifting: it spans the full width, so any
  // horizontal travel would clip against the viewBox. The insetted clouds
  // either side of it drift in opposite directions for parallax.
  cloudy: [
    { grid: CLOUD_BACK, tone: 'dim', motion: 'drift-rev' },
    { grid: CLOUD, tone: 'dim', motion: 'bob' },
    { grid: CLOUD_SMALL, tone: 'ink', motion: 'drift' }
  ],
  fog: [
    { grid: FOG_BARS_A, tone: 'dim', motion: 'drift' },
    { grid: FOG_BARS_B, tone: 'dim', motion: 'drift-rev' }
  ],
  drizzle: [
    { grid: CLOUD, tone: 'dim', motion: 'bob-slow' },
    { grid: DRIZZLE_DROPS, tone: 'ink', motion: 'fall-slow' },
    { grid: DRIZZLE_DROPS_B, tone: 'ink', motion: 'fall-slow-late' }
  ],

  // Three grades of rain and of snow. The cloud BOBS rather than drifting —
  // it spans the full width, so horizontal travel would clip the viewBox.
  rainLight: [
    { grid: CLOUD, tone: 'dim', motion: 'bob-slow' },
    { grid: RAIN_LIGHT, tone: 'ink', motion: 'fall-slow' },
    { grid: RAIN_LIGHT_B, tone: 'ink', motion: 'fall-slow-late' }
  ],
  rain: [
    { grid: CLOUD, tone: 'dim', motion: 'bob-slow' },
    { grid: RAIN_DROPS, tone: 'ink', motion: 'fall' },
    { grid: RAIN_DROPS_B, tone: 'ink', motion: 'fall-late' }
  ],
  rainHeavy: [
    { grid: CLOUD, tone: 'dim', motion: 'bob' },
    { grid: RAIN_HEAVY, tone: 'ink', motion: 'fall-fast' },
    { grid: RAIN_HEAVY_B, tone: 'ink', motion: 'fall-fast-late' }
  ],

  snowLight: [
    { grid: CLOUD, tone: 'dim', motion: 'bob-slow' },
    { grid: SNOW_LIGHT, tone: 'ink', motion: 'fall-slow' },
    { grid: SNOW_LIGHT_B, tone: 'ink', motion: 'fall-slow-late' }
  ],
  snow: [
    { grid: CLOUD, tone: 'dim', motion: 'bob-slow' },
    { grid: SNOW_FLAKES, tone: 'ink', motion: 'fall-slow' },
    { grid: SNOW_FLAKES_B, tone: 'ink', motion: 'fall-slow-late' }
  ],
  snowHeavy: [
    { grid: CLOUD, tone: 'dim', motion: 'bob' },
    { grid: SNOW_HEAVY, tone: 'ink', motion: 'fall-slow' },
    { grid: SNOW_HEAVY_B, tone: 'ink', motion: 'fall-slow-late' }
  ],

  // Thunderstorm is bolt over rain; hail is bolt over chunky pellets. Both
  // carry the bolt because both WMO groups are thunderstorms — the
  // precipitation is what tells them apart.
  storm: [
    { grid: CLOUD, tone: 'dim', motion: 'bob' },
    { grid: RAIN_DROPS, tone: 'dim', motion: 'fall' },
    { grid: BOLT, tone: 'ink', motion: 'flash' }
  ],
  hail: [
    { grid: CLOUD, tone: 'dim', motion: 'bob' },
    { grid: HAIL_STONES, tone: 'ink', motion: 'fall-fast' },
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
