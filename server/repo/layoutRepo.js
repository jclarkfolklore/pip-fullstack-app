const { db } = require('../db');

function listWidgets() {
  return db.prepare('SELECT * FROM widgets WHERE enabled = 1 ORDER BY sort_order ASC').all();
}

function setWidgetOrder(id, sortOrder) {
  db.prepare('UPDATE widgets SET sort_order = ? WHERE id = ?').run(sortOrder, id);
}

function setWidgetEnabled(id, enabled) {
  db.prepare('UPDATE widgets SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

module.exports = { listWidgets, setWidgetOrder, setWidgetEnabled };
