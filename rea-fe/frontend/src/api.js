const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || 'Request failed');
  }
  return data;
}

export async function fetchOffers(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, value);
    }
  });
  const res = await fetch(`${API_BASE}/api/offers?${query}`);
  return readJson(res);
}

export async function getOffer(externalId) {
  const res = await fetch(`${API_BASE}/api/offers/${encodeURIComponent(externalId)}`);
  return readJson(res);
}

export async function getOfferAudit(externalId, limit = 20) {
  const res = await fetch(`${API_BASE}/api/offers/${encodeURIComponent(externalId)}/audit?limit=${limit}`);
  return readJson(res);
}

export async function updateOffer(externalId, data) {
  const res = await fetch(`${API_BASE}/api/offers/${encodeURIComponent(externalId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return readJson(res);
}

export async function reviewOffer(externalId, data) {
  const res = await fetch(`${API_BASE}/api/offers/${encodeURIComponent(externalId)}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return readJson(res);
}

export async function reEvaluateOffer(externalId) {
  const res = await fetch(`${API_BASE}/api/offers/${encodeURIComponent(externalId)}/re-evaluate`, {
    method: 'POST',
  });
  return readJson(res);
}

export async function fetchStats(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, value);
    }
  });
  const res = await fetch(`${API_BASE}/api/stats?${query}`);
  return readJson(res);
}

export async function fetchCategories() {
  const res = await fetch(`${API_BASE}/api/categories`);
  return readJson(res);
}

export async function fetchImportRuns(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, value);
    }
  });
  const suffix = query.toString() ? `?${query}` : '';
  const res = await fetch(`${API_BASE}/api/import-runs${suffix}`);
  return readJson(res);
}

export async function getImportRun(runId) {
  const res = await fetch(`${API_BASE}/api/import-runs/${encodeURIComponent(runId)}`);
  return readJson(res);
}

export async function fetchImportRunEvents(runId, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, value);
    }
  });
  const suffix = query.toString() ? `?${query}` : '';
  const res = await fetch(`${API_BASE}/api/import-runs/${encodeURIComponent(runId)}/events${suffix}`);
  return readJson(res);
}

export async function fetchImportRunNewPending(runId) {
  const res = await fetch(`${API_BASE}/api/import-runs/${encodeURIComponent(runId)}/new-pending`);
  return readJson(res);
}
