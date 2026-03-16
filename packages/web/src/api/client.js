const BASE = '/api/v1';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  const body = await res.json();
  if (!body.ok) {
    const err = new Error(body.error?.message || 'Unknown error');
    err.code = body.error?.code;
    err.status = res.status;
    throw err;
  }

  return body;
}

function cleanFilters(filters = {}) {
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return new URLSearchParams(entries).toString();
}

export const api = {
  listDiagrams: (filters = {}) => request(`/diagrams${cleanFilters(filters) ? `?${cleanFilters(filters)}` : ''}`),
  getDiagram: (slug) => request(`/diagrams/${slug}`),
  createDiagram: (data) => request('/diagrams', { method: 'POST', body: JSON.stringify(data) }),
  updateDiagram: (slug, data) => request(`/diagrams/${slug}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDiagram: (slug, version) => request(`/diagrams/${slug}`, { method: 'DELETE', body: JSON.stringify({ version }) }),
  restoreDiagram: (slug) => request(`/diagrams/${slug}/restore`, { method: 'POST' }),
};
