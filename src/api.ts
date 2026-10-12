export interface UserInfo {
  id: number; username: string; nickname: string; avatar: string; signature: string;
  role: string; status: string; createdAt: number; email: string | null; hasPassword?: boolean;
}
export interface AuthorInfo { id: number; username: string; nickname: string; avatar: string }
export interface NoteInfo {
  id: number; userId: number; title: string; content: string; tags: string[];
  weather: string; location: string; visibility: string; pinned: boolean; archived: boolean;
  createdAt: number; updatedAt: number; author: AuthorInfo | null;
  allowComments: boolean; commentCount: number; viewCount: number; expiresAt: number | null;
}
export interface CommentInfo {
  id: number; noteId: number; userId: number; content: string; createdAt: number;
  author: AuthorInfo | null;
}
export interface SiteInfo {
  name: string; subtitle: string; description: string; keywords: string; footer: string;
  icp: string; logo: string; accent: string; registerOpen: boolean; inviteOnly: boolean;
  videoUpload: { enabled: boolean; maxMb: number }; fileUpload: { enabled: boolean; maxMb: number }; oauthProviders: string[];
}

// ---------- 主题强调色 ----------
// 全站强调色收敛到 --accent 及其衍生（--accent-dark 悬停、--accent-soft 浅底、--on-accent 其上文字），
// 默认蓝色；后台设置后服务端随 HTML 注入、客户端水合时同步，首帧即生效
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(h1: string, h2: string, r: number): string {
  const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
  const ch = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  const m = (x: number, y: number) => ch(x * r + y * (1 - r));
  return `#${m((a >> 16) & 255, (b >> 16) & 255)}${m((a >> 8) & 255, (b >> 8) & 255)}${m(a & 255, b & 255)}`;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const l = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * l((n >> 16) & 255) + 0.7152 * l((n >> 8) & 255) + 0.0722 * l(n & 255);
}
export function accentCss(hex: string): string {
  const onL = luminance(hex) > 0.45 ? "#202124" : "#ffffff";
  const dAcc = shade(hex, 0.28);
  const onD = luminance(dAcc) > 0.45 ? "#202124" : "#ffffff";
  return `:root{--accent:${hex};--accent-dark:${shade(hex, -0.15)};--accent-soft:${mix(hex, "#ffffff", 0.12)};--on-accent:${onL}}` +
    `[data-theme="dark"]{--accent:${dAcc};--accent-dark:${shade(hex, 0.42)};--accent-soft:${mix(hex, "#201d19", 0.30)};--on-accent:${onD}}`;
}
export function applyAccent(hex: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  let el = document.getElementById("np-accent") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "np-accent";
    document.head.appendChild(el);
  }
  el.textContent = accentCss(hex);
}

// 首屏站点信息水合：优先服务端注入 index.html 的 window.__NP_SITE__，其次上次访问的本地缓存，
// 都没有才返回 null（调用方先渲染中性占位，等 /api/site 回来再填真品牌，杜绝「己素/蓝 N」闪烁）
export function bootSite(): SiteInfo | null {
  const w = (window as unknown as { __NP_SITE__?: SiteInfo }).__NP_SITE__;
  if (w && typeof w.name === "string") return w;
  try {
    const c = localStorage.getItem("np-site");
    if (c) {
      const s = JSON.parse(c) as SiteInfo;
      if (s && typeof s.name === "string") return s;
    }
  } catch { /* 缓存损坏则忽略 */ }
  return null;
}
export function cacheSite(s: SiteInfo): void {
  try { localStorage.setItem("np-site", JSON.stringify(s)); } catch { /* 存储不可用则忽略 */ }
}
export const DEFAULT_ICON = "/favicon-32.png?v=2";
export function syncFavicon(href: string): void {
  for (const rel of ["icon", "apple-touch-icon"]) {
    const link = document.querySelector(`link[rel="${rel}"]`);
    if (link && link.getAttribute("href") !== href) link.setAttribute("href", href);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || data.ok === false) throw new Error(String(data.error || `请求失败（${r.status}）`));
  return data as T;
}
export const api = {
  get: <T>(url: string) => req<T>("GET", url),
  post: <T>(url: string, body?: unknown) => req<T>("POST", url, body ?? {}),
  put: <T>(url: string, body?: unknown) => req<T>("PUT", url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => req<T>("PATCH", url, body ?? {}),
  del: <T>(url: string) => req<T>("DELETE", url),
  async upload(url: string, file: File): Promise<{ path: string; url: string }> {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(url, { method: "POST", body: fd, credentials: "same-origin" });
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || data.ok === false) throw new Error(String(data.error || "上传失败"));
    return data as unknown as { path: string; url: string };
  },
};

export const fmtTime = (ts: number) => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
