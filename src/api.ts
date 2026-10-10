export interface UserInfo {
  id: number; username: string; nickname: string; avatar: string; signature: string;
  role: string; status: string; createdAt: number; email: string | null; hasPassword?: boolean;
}
export interface AuthorInfo { id: number; username: string; nickname: string; avatar: string }
export interface NoteInfo {
  id: number; userId: number; title: string; content: string; tags: string[];
  weather: string; location: string; visibility: string; pinned: boolean; archived: boolean;
  createdAt: number; updatedAt: number; author: AuthorInfo | null;
  allowComments: boolean; commentCount: number;
}
export interface CommentInfo {
  id: number; noteId: number; userId: number; content: string; createdAt: number;
  author: AuthorInfo | null;
}
export interface SiteInfo {
  name: string; subtitle: string; description: string; keywords: string; footer: string;
  icp: string; logo: string; registerOpen: boolean; oauthProviders: string[];
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
