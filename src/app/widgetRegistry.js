// Static imports on purpose: this app is opened via file://, so we bundle
// every widget into the one output file rather than lazy-loading chunks
// (dynamic import()/fetch of separate chunks is unreliable under file://).
// Adding a new widget = new folder under src/widgets + one line here.

import * as inbox from '../widgets/inbox/inboxWidget.js';
import * as tasks from '../widgets/tasks/tasksWidget.js';
import * as pacing from '../widgets/pacing/pacingWidget.js';
import * as overview from '../widgets/overview/overviewWidget.js';

const registry = {
  inbox,
  tasks,
  pacing,
  overview
};

export function getWidgetModule(kind) {
  return registry[kind] || null;
}
