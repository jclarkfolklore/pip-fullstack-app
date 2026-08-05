// Watches <project-folder>/data/drops/*.md for new files and auto-imports
// them — this is the main Claude -> app pipeline now that the app is a real
// server: Claude just writes a markdown file with frontmatter (same
// convention as the old static-app "IMPORT" button, minus the click).
// Successfully-processed files move into data/drops/processed/ so the
// watcher doesn't re-scan them and the drops/ folder stays a clean "pending
// for import" queue.
const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./lib/frontmatter');
const inboxRepo = require('./repo/inboxRepo');
const notesRepo = require('./repo/notesRepo');
const projectsRepo = require('./repo/projectsRepo');

const DROPS_DIR = process.env.PIP_DROPS_PATH || path.resolve(__dirname, '..', 'data', 'drops');
const PROCESSED_DIR = path.join(DROPS_DIR, 'processed');

function slugTitleFrom(body) {
  const line = (body || '').split('\n').find((l) => l.trim().length);
  return (line || 'untitled note').replace(/^#+\s*/, '').slice(0, 80);
}

function resolveProjectId(data) {
  if (data.projectId) return data.projectId;
  if (data.project) return projectsRepo.findOrCreateByName(data.project);
  return null;
}

function importOne(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const id = data.id || path.basename(filePath, '.md');
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const projectId = resolveProjectId(data);
  const common = {
    id,
    title: data.title || slugTitleFrom(body),
    bodyMd: body,
    tags,
    createdAt: data.createdAt,
    source: data.source || 'claude',
    sourceType: data.sourceType || 'chat',
    sourceUrl: data.sourceUrl || null,
    projectId
  };

  const kind = (data.kind || 'inbox').toLowerCase();
  if (kind === 'note') {
    return notesRepo.importDroppedNote({ ...common, pinned: data.pinned === 'true' });
  }
  return inboxRepo.importDroppedNote(common);
}

function scanOnce({ verbose = false } = {}) {
  if (!fs.existsSync(DROPS_DIR)) return { imported: 0 };
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  const files = fs.readdirSync(DROPS_DIR).filter((f) => f.endsWith('.md'));
  let imported = 0;
  for (const file of files) {
    const fullPath = path.join(DROPS_DIR, file);
    try {
      const result = importOne(fullPath);
      if (result.created) imported += 1;
      if (verbose) console.log(`[pip] drop ${file}: ${result.created ? 'imported' : 'already had'} (${result.id})`);
      fs.renameSync(fullPath, path.join(PROCESSED_DIR, file));
    } catch (err) {
      console.warn(`[pip] failed to import drop ${file}:`, err.message);
    }
  }
  return { imported };
}

function startDropsWatcher({ intervalMs = 3000 } = {}) {
  fs.mkdirSync(DROPS_DIR, { recursive: true });
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  scanOnce({ verbose: true });
  const timer = setInterval(() => scanOnce({ verbose: true }), intervalMs);
  return () => clearInterval(timer);
}

module.exports = { startDropsWatcher, scanOnce, DROPS_DIR, PROCESSED_DIR };
