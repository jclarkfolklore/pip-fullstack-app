// Static imports — the app is now served over http (real server, not
// file://), so dynamic import() would work fine here if this ever needs to
// lazy-load, but there's no pressing need yet: it's still a small bundle.
// Adding a new widget = new folder under src/widgets + one line here.

import * as inbox from '../widgets/inbox/inboxWidget.js';
import * as tasks from '../widgets/tasks/tasksWidget.js';
import * as notes from '../widgets/notes/notesWidget.js';
import * as journal from '../widgets/journal/journalWidget.js';
import * as projects from '../widgets/projects/projectsWidget.js';
import * as metrics from '../widgets/metrics/metricsWidget.js';
import * as settings from '../widgets/settings/settingsWidget.js';

const registry = {
  inbox,
  tasks,
  notes,
  journal,
  projects,
  metrics,
  settings
};

export function getWidgetModule(kind) {
  return registry[kind] || null;
}

// Dashboard grouping display order + labels. A widget's group_name (set in
// server/schema.js SEED_WIDGETS / MIGRATIONS) must have an entry here or its
// tile falls into a trailing "MORE" group instead of being silently dropped.
export const GROUPS = [
  { key: 'work', label: 'WORK' },
  { key: 'insights', label: 'INSIGHTS' },
  { key: 'system', label: 'SYSTEM' }
];
