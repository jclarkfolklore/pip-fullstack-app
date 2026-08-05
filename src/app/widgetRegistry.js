// Static imports — the app is now served over http (real server, not
// file://), so dynamic import() would work fine here if this ever needs to
// lazy-load, but there's no pressing need yet: it's still a small bundle.
// Adding a new widget = new folder under src/widgets + one line here.

import * as inbox from '../widgets/inbox/inboxWidget.js';
import * as tasks from '../widgets/tasks/tasksWidget.js';
import * as notes from '../widgets/notes/notesWidget.js';
import * as projects from '../widgets/projects/projectsWidget.js';
import * as metrics from '../widgets/metrics/metricsWidget.js';
import * as overview from '../widgets/overview/overviewWidget.js';

const registry = {
  inbox,
  tasks,
  notes,
  projects,
  metrics,
  overview
};

export function getWidgetModule(kind) {
  return registry[kind] || null;
}
