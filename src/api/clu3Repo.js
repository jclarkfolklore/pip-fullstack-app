import { apiGet, apiPost, apiPatch, apiDelete } from './client.js';

export function clu3State() {
  return apiGet('/api/clu3');
}

export function getTone() {
  return apiGet('/api/clu3/tone');
}

export function setTone(tone) {
  return apiPatch('/api/clu3/tone', { tone });
}

export function listMessages() {
  return apiGet('/api/clu3/messages');
}

export function createMessage(data) {
  return apiPost('/api/clu3/messages', data);
}

export function dismissMessage(id) {
  return apiPost(`/api/clu3/messages/${id}/dismiss`, {});
}

export function deleteMessage(id) {
  return apiDelete(`/api/clu3/messages/${id}`);
}
