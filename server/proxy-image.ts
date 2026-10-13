// 服务端图片代理：登录态 + SSRF 防护，供分享海报加载外链图（同源回源，无 CORS 问题）。
// 纯校验/抓取逻辑抽成可单测的导出函数；路由只做鉴权与参数搬运。
import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

export const PROXY_MAX_BYTES = 8 * 1024 * 1024;
// 图床可能很慢（实测 cnb.jisu.cn 约 130KB/s，2MB 图需 ~16s），超时太短会把好图当失败剔除
export const PROXY_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
// 信任域名白名单：用户自有基础设施（云盘 share.jisu.cn），
// 即使在内网 DNS 解析到私有 IP 也允许代理（SSRF 防护对白名单域名放行）。
const TRUSTED_PROXY_HOSTS = new Set(["share.jisu.cn"]);

// 浏览器身份请求头：部分图床/ CDN 会拦截无 UA 或非浏览器 UA 的服务端抓取
//（notes 项目走服务端 Playwright 真实浏览器截图，故不受影响；本代理是直连 fetch，必须带浏览器身份）
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

export class ProxyImageError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const perr = (status: number, message: string) => new ProxyImageError(status, message);

// 私网/回环/链路本地/组播/保留等禁止访问的 IP（含 IPv4 映射的 IPv6）
export function isBlockedIp(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 运营商级 NAT
    if (a === 127) return true; // 127/8 回环
    if (a === 169 && b === 254) return true; // 169.254/16 链路本地（含云元数据）
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a >= 224) return true; // 224/4 组播 + 240/4 保留
    return false;
  }
  if (fam === 6) {
    const n = ip.toLowerCase();
    if (n === "::" || n === "::1") return true;
    if (n.startsWith("::ffff:")) {
      // IPv4 映射的 IPv6：按内嵌的 IPv4 精确判定，而非整段拦截
      //（双栈环境下 DNS 可能返回映射形式，公网 IP 不应被误杀；127.0.0.1 等仍被 IPv4 规则拦截）
      const v4 = n.slice("::ffff:".length);
      if (net.isIP(v4) === 4) return isBlockedIp(v4);
      return true; // 非标准形式保守拦截
    }
    const first = parseInt(n.split(":")[0] || "0", 16);
    if (Number.isNaN(first)) return true;
    if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10 链路本地
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 组播
    return false;
  }
  return true; // 不是合法 IP 字面量 → 保守拦截
}

export type DnsLookupFn = (
  host: string,
  opts: { all: true; verbatim: true }
) => Promise<{ address: string }[]>;

// 结构校验（协议/端口/主机名）+ DNS 解析后逐 IP 检查；通过返回可抓取的 URL，不通过抛 ProxyImageError
export async function assertProxyTarget(raw: string, resolve: DnsLookupFn = dnsLookup): Promise<URL> {
  let u: URL;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    throw perr(400, "图片地址无效");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw perr(400, "只允许 http/https 图片地址");
  if (u.port !== "") throw perr(400, "不允许非常规端口");
  const host = u.hostname.replace(/^\[|\]$/g, ""); // IPv6 字面量去括号
  if (!host) throw perr(400, "图片地址无效");
  if (/^[0-9.]+$/.test(host) && net.isIP(host) !== 4) throw perr(400, "目标地址被拦截"); // 十进制 IP 伪装
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw perr(400, "目标地址被拦截");
    return u;
  }
  let addrs: { address: string }[];
  try {
    addrs = await resolve(host, { all: true, verbatim: true });
  } catch {
    throw perr(502, "域名解析失败");
  }
  if (!addrs || addrs.length === 0) throw perr(502, "域名解析失败");
  // 白名单域名（用户自有基础设施）跳过私网 IP 拦截
  if (TRUSTED_PROXY_HOSTS.has(host.toLowerCase())) return u;
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw perr(400, "目标地址被拦截");
  }
  return u;
}

// 抓取图片字节（调用前须已做 assertProxyTarget）；重定向手动跟随并逐跳重验
export async function fetchProxyImage(
  start: URL,
  signal: AbortSignal,
  resolve: DnsLookupFn = dnsLookup
): Promise<{ bytes: Buffer; contentType: string }> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let r: Response;
    try {
      r = await fetch(current.toString(), { redirect: "manual", signal, headers: BROWSER_HEADERS });
    } catch (e) {
      if ((e as Error)?.name === "AbortError" || signal.aborted) throw perr(502, "抓取超时");
      throw perr(502, "图片抓取失败");
    }
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      if (hop === MAX_REDIRECTS) throw perr(502, "重定向过多");
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        throw perr(502, "重定向地址无效");
      }
      current = await assertProxyTarget(next.toString(), resolve); // 逐跳重验 SSRF
      continue;
    }
    if (!r.ok) throw perr(502, `上游返回 ${r.status}`);
    const ct = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ct.startsWith("image/")) throw perr(502, "目标不是图片");
    const len = Number(r.headers.get("content-length"));
    if (Number.isFinite(len) && len > PROXY_MAX_BYTES) throw perr(502, "图片过大");
    if (!r.body) throw perr(502, "上游无响应体");
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PROXY_MAX_BYTES) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw perr(502, "图片过大");
      }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks), contentType: ct };
  }
  throw perr(502, "重定向过多");
}
