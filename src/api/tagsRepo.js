import { apiGet } from './client.js';

export function allTagNames() {
  return apiGet('/api/tags');
}
