export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function formatDate(dateStr, fmt = 'YYYY-MM-DD') {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const map = {
    YYYY: d.getFullYear(),
    MM: String(d.getMonth() + 1).padStart(2, '0'),
    DD: String(d.getDate()).padStart(2, '0'),
    HH: String(d.getHours()).padStart(2, '0'),
    mm: String(d.getMinutes()).padStart(2, '0'),
    ss: String(d.getSeconds()).padStart(2, '0'),
  };
  let result = fmt;
  for (const [k, v] of Object.entries(map)) {
    result = result.replace(k, v);
  }
  return result;
}

export function relativeTime(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}个月前`;
  return `${Math.floor(months / 12)}年前`;
}

export function truncateText(text, maxLen = 200) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

export function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '');
}

export function getWeatherIcon(code) {
  if (!code && code !== 0) return '';
  return `icon-weather-${code}`;
}

export function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function getFirstDayOfWeek(year, month) {
  return new Date(year, month - 1, 1).getDay();
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

export function parseQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const result = {};
  for (const [k, v] of params.entries()) {
    result[k] = v;
  }
  return result;
}

export function buildMediaGrid(images) {
  if (!images || images.length === 0) return [];
  if (images.length <= 3) return [images];
  const rows = [];
  for (let i = 0; i < images.length; i += 3) {
    rows.push(images.slice(i, i + 3));
  }
  return rows;
}

export function scrollToTop(smooth = true) {
  window.scrollTo({
    top: 0,
    behavior: smooth ? 'smooth' : 'auto',
  });
}

export function isMobile() {
  return window.innerWidth < 880;
}

export function getColumnsCount() {
  const w = window.innerWidth;
  if (w >= 1600) return 3;
  if (w >= 1240) return 2;
  return 1;
}
