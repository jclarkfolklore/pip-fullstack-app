// Minimal YAML-frontmatter parser — supports exactly the shape we ask
// Claude/ourselves to write: flat scalar keys, quoted or bare strings,
// and inline lists like `tags: [one, two, "three four"]`. Not a general
// YAML parser on purpose — keeps the app dependency-free for this bit.

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

export function parseFrontmatter(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) {
    return { data: {}, body: text.trim() };
  }
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

export function stringifyFrontmatter(data, body) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => `"${v}"`).join(', ')}]`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---', '', body);
  return lines.join('\n');
}
