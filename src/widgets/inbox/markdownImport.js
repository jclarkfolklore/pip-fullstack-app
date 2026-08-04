import { parseFrontmatter } from '../../lib/frontmatter.js';
import { importDroppedNote } from '../../db/repo/inboxRepo.js';

// Convention: Claude (or you) writes one .md file per note into
// `inbox/drops/` in the project folder, e.g.:
//
//   ---
//   id: "9f2c...-uuid"
//   title: "Follow up with Corey on the Best Buy plans ticket"
//   tags: ["work", "best-buy"]
//   source: "claude"
//   createdAt: "2026-08-04T18:00:00Z"
//   ---
//   Corey opened a new high-priority ticket asking to schedule a walkthrough...
//
// Tapping "Import Notes" on the Inbox screen opens a folder picker
// (works even with the app opened via file://, since it's a user-driven
// picker, not a network fetch). Every .md file in the folder is parsed and
// inserted if its `id` isn't already present — so re-importing the same
// folder is always safe.

function slugTitleFrom(body) {
  const line = body.split('\n').find((l) => l.trim().length);
  return (line || 'untitled note').replace(/^#+\s*/, '').slice(0, 80);
}

export function pickAndImportDrops() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.webkitdirectory = true;
    input.accept = '.md';
    input.onchange = async () => {
      const files = Array.from(input.files || []).filter((f) => f.name.endsWith('.md'));
      let created = 0;
      let skipped = 0;
      for (const file of files) {
        const text = await file.text();
        const { data, body } = parseFrontmatter(text);
        const id = data.id || `${file.name}`;
        const tags = Array.isArray(data.tags) ? data.tags : [];
        const result = importDroppedNote({
          id,
          title: data.title || slugTitleFrom(body),
          bodyMd: body,
          tags,
          createdAt: data.createdAt,
          source: data.source || 'claude'
        });
        if (result.created) created += 1;
        else skipped += 1;
      }
      resolve({ created, skipped, total: files.length });
    };
    input.click();
  });
}
