import { all, run } from '../client.js';

export function listWidgets() {
  return all('SELECT * FROM widgets WHERE enabled = 1 ORDER BY sort_order ASC');
}

export function setWidgetOrder(id, sortOrder) {
  run('UPDATE widgets SET sort_order = ? WHERE id = ?', [sortOrder, id]);
}

export function setWidgetEnabled(id, enabled) {
  run('UPDATE widgets SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}
