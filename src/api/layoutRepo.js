import { apiGet, apiPatch } from './client.js';

export function listWidgets() {
  return apiGet('/api/widgets');
}

export function setWidgetOrder(id, sortOrder) {
  return apiPatch(`/api/widgets/${id}`, { sortOrder });
}

export function setWidgetEnabled(id, enabled) {
  return apiPatch(`/api/widgets/${id}`, { enabled });
}
