export interface UserInfo {
  id: number; username: string; nickname: string; avatar: string; signature: string;
  role: string; status: string; createdAt: number; email: string | null; hasPassword?: boolean;
}
export interface AuthorInfo { id: number; username: string; nickname: string; avatar: string }
export interface NoteInfo {
  id: number; userId: number; title: string; content: string; tags: string[];
  weather: string; location: string; visibility: string; pinned: boolean; archived: boolean;
  createdAt: number; updatedAt: number; author: AuthorInfo | null;
}
export interface SiteInfo {
  name: string; subtitle: string; description: string; keywords: string; footer: string;
  logo: string; registerOpen: boolean; oauthProviders: string[];
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
