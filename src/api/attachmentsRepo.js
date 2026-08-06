// Client for /api/attachments — images and links hanging off any entity.
// Mirrors server/repo/attachmentsRepo.js, same as every other file in here.

import { apiGet, apiPost, apiDelete, qs } from './client.js';

export function listAttachments(entityType, entityId) {
  return apiGet('/api/attachments' + qs({ entityType, entityId }));
}

// One request for a whole list of cards, returned keyed by entity id.
export function listAttachmentsForMany(entityType, entityIds = []) {
  if (!entityIds.length) return Promise.resolve({});
  return apiGet('/api/attachments' + qs({ entityType, entityIds: entityIds.join(',') }));
}

export function addAttachment(body) {
  return apiPost('/api/attachments', body);
}

export function deleteAttachment(id) {
  return apiDelete(`/api/attachments/${id}`);
}

export function sweepAttachments() {
  return apiPost('/api/attachments/sweep', {});
}
