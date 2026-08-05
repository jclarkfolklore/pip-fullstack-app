// CommonJS twin of src/lib/frontmatter.js — same minimal parser, duplicated
// rather than shared across the ESM (webpack-bundled frontend) / CommonJS
// (plain Node backend) boundary. Keep both in sync if the format changes.

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseValue(raw) {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => parseScalar(item));
  }
  return parseScalar(v);
}

function parseFrontmatter(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return { data: {}, body: text.trim() };
  const [, fmBlock, body] = match;
  const data = {};
  for (const line of fmBlock.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1);
    data[key] = parseValue(value);
  }
  return { data, body: body.trim() };
}

module.exports = { parseFrontmatter };
