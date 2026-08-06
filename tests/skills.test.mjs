// Skills — testing the parts of a prompt that CAN be tested.
//
// A skill is a prompt, so it can never be deterministic the way a function is.
// But most of what goes wrong with one isn't the model's interpretation — it's
// the skill confidently referencing a script that was renamed, an endpoint that
// moved, or a code snippet that stopped working. Those are all checkable, and
// they're the failures that waste the most time because the skill still *reads*
// correct.
//
// What's covered:
//   - every file path a skill references exists
//   - every API endpoint a skill references is actually mounted
//   - the JS snippets embedded in a skill still parse AND still behave
//   - frontmatter is present and the declared name matches the directory
//
// What isn't, and can't be: whether the model follows the instructions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SKILLS_DIR = '.claude/skills';

function skills() {
  return readdirSync(SKILLS_DIR)
    .filter((d) => existsSync(join(SKILLS_DIR, d, 'SKILL.md')))
    .map((d) => ({
      name: d,
      path: join(SKILLS_DIR, d, 'SKILL.md'),
      body: readFileSync(join(SKILLS_DIR, d, 'SKILL.md'), 'utf8')
    }));
}

test('every skill has frontmatter whose name matches its directory', () => {
  for (const s of skills()) {
    const fm = s.body.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, `${s.name}: has frontmatter`);
    const name = (fm[1].match(/^name:\s*(.+)$/m) || [])[1];
    const desc = (fm[1].match(/^description:\s*(.+)$/m) || [])[1];
    assert.equal(name && name.trim(), s.name, `${s.name}: declared name matches directory`);
    assert.ok(desc && desc.trim().length > 40, `${s.name}: description is substantial enough to route on`);
  }
});

test('every file path a skill references exists', () => {
  // The highest-frequency rot: a script gets renamed and the skill keeps
  // confidently telling you to run the old one.
  const missing = [];
  for (const s of skills()) {
    const refs = new Set(
      s.body.match(/(?:scripts|server|src|tests)\/[a-zA-Z0-9/_.-]+\.(?:js|mjs|json)/g) || []
    );
    for (const ref of refs) {
      if (!existsSync(ref)) missing.push(`${s.name} -> ${ref}`);
    }
  }
  assert.deepEqual(missing, [], `skills reference files that don't exist:\n  ${missing.join('\n  ')}`);
});

test('every API endpoint a skill references is mounted', () => {
  // Two places a route can live: a file under server/routes, or mounted
  // inline in server/index.js (as /api/health is). Missing the second would
  // make this test fail on a perfectly real endpoint.
  const mounted = readdirSync('server/routes')
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace('.js', ''));
  const index = readFileSync('server/index.js', 'utf8');
  for (const m of index.matchAll(/app\.(?:get|post|patch|delete)\(\s*['"]\/api\/([a-z0-9-]+)/g)) {
    mounted.push(m[1]);
  }

  const missing = [];
  for (const s of skills()) {
    const refs = new Set(
      (s.body.match(/\/api\/[a-z0-9-]+/g) || []).map((r) => r.replace('/api/', '').split('/')[0])
    );
    for (const r of refs) {
      if (!mounted.includes(r)) missing.push(`${s.name} -> /api/${r}`);
    }
  }
  assert.deepEqual(missing, [], `skills reference unmounted endpoints:\n  ${missing.join('\n  ')}`);
});

test('embedded JS snippets still parse', () => {
  // A snippet with a syntax error is worse than no snippet — it gets pasted
  // into a browser console and fails in a way that looks like the page's fault.
  for (const s of skills()) {
    const blocks = [...s.body.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]);
    blocks.forEach((code, i) => {
      assert.doesNotThrow(
        () => {
          // Top-level await is legal in these snippets, so parse as a module.

          new Function(`return (async () => {\n${code}\n})`);
        },
        `${s.name}: js block ${i + 1} parses`
      );
    });
  }
});

test("ado-sync's discussion extractor still works on real ADO page text", () => {
  // This is the snippet that pulls QA comments off a work item, and comments
  // routinely change the work. Rather than trust that it still looks right,
  // run the exact code from the skill against a fixture of real page text.
  const skill = skills().find((s) => s.name === 'ado-sync');
  assert.ok(skill, 'ado-sync exists');

  const block = [...skill.body.matchAll(/```js\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .find((c) => c.includes("lastIndexOf('\\nDiscussion\\n')"));
  assert.ok(block, 'the discussion-slicing snippet is still in the skill');

  // Shaped exactly like a real ADO work-item page dump.
  const pageText = [
    'USER STORY 184216',
    'Description',
    'Some description text about the bug.',
    'Acceptance Criteria',
    'Discussion',
    'Markdown supported.',
    'Paste or select files to insert.',
    'switch to HTML editor',
    'Kyle Johnson',
    'commented Yesterday',
    '@Corey Singleton issue 1 is present but issue 2 I was not able to reproduce.',
    'Details',
    'Priority',
    'CapEx'
  ].join('\n');

  const extract = new Function('document', `${block}\n return d;`);
  const out = extract({ body: { innerText: pageText } });

  assert.ok(out.includes('Kyle Johnson'), 'captures the commenter');
  assert.ok(out.includes('issue 2 I was not able to reproduce'), 'captures the comment body');
  assert.ok(!out.includes('Markdown supported'), 'strips the editor boilerplate');
  assert.ok(!out.includes('CapEx'), 'stops before the Details panel');
  assert.ok(!out.includes('Some description text'), 'does not swallow the description');
});

test("ado-sync's image finder matches ADO attachment URLs and nothing else", () => {
  const skill = skills().find((s) => s.name === 'ado-sync');
  const block = [...skill.body.matchAll(/```js\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .find((c) => c.includes('_apis') && c.includes('fileName'));
  assert.ok(block, 'the image-finding snippet is still in the skill');

  const imgs = [
    {
      src: 'https://dev.azure.com/Org/guid/_apis/wit/attachments/abc?fileName=Screenshot%201.png',
      naturalWidth: 800,
      naturalHeight: 600
    },
    { src: 'https://cdn.vsassets.io/some/avatar.png', naturalWidth: 32, naturalHeight: 32 },
    {
      src: 'https://dev.azure.com/Org/_apis/wit/attachments/def?fileName=diagram.png',
      naturalWidth: 100,
      naturalHeight: 100
    }
  ];

  const find = new Function('document', `return ${block.trim().replace(/;$/, '')}`);
  const out = find({ querySelectorAll: () => imgs });

  assert.equal(out.length, 2, 'matches only the two real attachments, not the avatar');
  assert.equal(out[0].file, 'Screenshot 1.png', 'decodes the filename');
  assert.equal(out[1].file, 'diagram.png');
});

test('sync skills require the ticket number and link they claim to enforce', () => {
  // The skills promise pip-upsert aborts without sourceRef/sourceUrl. If that
  // enforcement were ever removed, the skills would be lying.
  const upsert = readFileSync('scripts/pip-upsert.js', 'utf8');
  assert.ok(upsert.includes('sourceRef'), 'upsert still checks sourceRef');
  assert.ok(upsert.includes('sourceUrl'), 'upsert still checks sourceUrl');
  assert.match(upsert, /process\.exit\(1\)/, 'and still aborts rather than warning');
});
