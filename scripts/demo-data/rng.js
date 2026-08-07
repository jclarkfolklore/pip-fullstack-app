// Seeded random-number source, isolated in its own module so its internal
// state can't leak into or get confused with anyone else's — every caller
// gets its own generator from createRng(), rather than sharing one hidden
// module-level counter the way the original single-file version did.
//
// Deterministic on purpose: the whole demo dataset is reproducible from one
// fixed seed, so a re-run produces the same workspace and a diff against a
// previous run means something.
function createRng(seed = 0x9e3779b9) {
  let state = seed;

  function rnd() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const chance = (p) => rnd() < p;
  function sample(arr, n) {
    const copy = arr.slice();
    const out = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
    return out;
  }

  return { rnd, pick, int, chance, sample };
}

module.exports = { createRng };
