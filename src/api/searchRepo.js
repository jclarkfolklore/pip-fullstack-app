import { apiGet } from './client.js';

export function search(query, { limit = 30 } = {}) {
  if (!query || !query.trim()) return Promise.resolve([]);
  return apiGet(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}
