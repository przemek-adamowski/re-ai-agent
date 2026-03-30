const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export async function fetchOffers(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, value);
    }
  });
  const res = await fetch(`${API_BASE}/api/offers?${query}`);
  return res.json();
}

export async function getOffer(externalId) {
  const res = await fetch(`${API_BASE}/api/offers/${encodeURIComponent(externalId)}`);
  return res.json();
}

export async function updateOffer(externalId, data) {
  const res = await fetch(`${API_BASE}/api/offers/${encodeURIComponent(externalId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function fetchStats(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, value);
    }
  });
  const res = await fetch(`${API_BASE}/api/stats?${query}`);
  return res.json();
}

export async function fetchCategories() {
  const res = await fetch(`${API_BASE}/api/categories`);
  return res.json();
}
