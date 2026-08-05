import { apiGet } from './client.js';

export function getMetrics() {
  return apiGet('/api/metrics');
}
