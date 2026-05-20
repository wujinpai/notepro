const BASE = '/api';

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }
  const res = await fetch(url, config);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function upload(path, formData) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    body: formData,
  }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

export const auth = {
  status: () => request('/auth/status'),
  login: (password) => request('/auth/login', { method: 'POST', body: { password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (oldPwd, newPwd) =>
    request('/auth/password', { method: 'PUT', body: { oldPassword: oldPwd, newPassword: newPwd } }),
};

export const posts = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/posts${qs ? '?' + qs : ''}`);
  },
  get: (id) => request(`/posts?id=${encodeURIComponent(id)}`),
  create: (data) => request('/posts', { method: 'POST', body: data }),
  update: (id, data) => request('/posts', { method: 'PUT', body: { id, ...data } }),
  delete: (id) => request(`/posts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  search: (query) => request(`/posts?search=${encodeURIComponent(query)}`),
  byDate: (date) => request(`/posts?date=${encodeURIComponent(date)}`),
  byTag: (tag) => request(`/posts?tag=${encodeURIComponent(tag)}`),
};

export const settings = {
  get: () => request('/settings'),
  update: (data) => request('/settings', { method: 'PUT', body: { settings: data } }),
};

export const tags = {
  list: () => request('/tags'),
};

export const media = {
  upload: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return upload('/upload', fd);
  },
  delete: (url) => request('/upload', { method: 'DELETE', body: { url } }),
};

export const calendar = {
  month: (year, month) => request(`/calendar?month=${year}${String(month).padStart(2, '0')}`),
};

export const init = {
  create: (password) => request('/init', { method: 'POST', body: { password } }),
};
