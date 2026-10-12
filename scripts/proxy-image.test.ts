// 图片代理 SSRF 防护单元测试（node:test；跑：npx tsx --test scripts/proxy-image.test.ts）
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const { isBlockedIp, assertProxyTarget, fetchProxyImage, ProxyImageError } =
  await import("../server/proxy-image.js");

// 可控 DNS 替身：只解析我们给定的映射
const stubResolve = (map: Record<string, string[]>) => async (host: string) => {
  if (!(host in map)) throw new Error("ENOTFOUND");
  return map[host].map((address) => ({ address }));
};
const pub = stubResolve({ "cdn.example.com": ["93.184.216.34"] });
const mixed = stubResolve({ "evil.example.com": ["93.184.216.34", "10.0.0.1"] });

describe("isBlockedIp", () => {
  it("私网段全部拦截", () => {
    for (const ip of ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1"]) {
      assert.equal(isBlockedIp(ip), true, ip);
    }
  });
  it("172.16/12 边界正确", () => {
    assert.equal(isBlockedIp("172.15.0.1"), false);
    assert.equal(isBlockedIp("172.32.0.1"), false);
  });
  it("回环/链路本地/元数据地址拦截", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "169.254.169.254", "0.0.0.0"]) {
      assert.equal(isBlockedIp(ip), true, ip);
    }
  });
  it("组播与保留段拦截", () => {
    assert.equal(isBlockedIp("224.0.0.1"), true);
    assert.equal(isBlockedIp("240.0.0.1"), true);
  });
  it("IPv6 特殊地址拦截", () => {
    for (const ip of ["::1", "::", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "fe80::1", "fc00::1", "fd00::1", "ff02::1"]) {
      assert.equal(isBlockedIp(ip), true, ip);
    }
  });
  it("IPv4 映射的公网地址放行（按内嵌 IPv4 精确判定）", () => {
    assert.equal(isBlockedIp("::ffff:8.8.8.8"), false);
    assert.equal(isBlockedIp("::ffff:1.1.1.1"), false);
  });
  it("公网 IP 放行", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "1.1.1.1", "2001:4860:4860::8888"]) {
      assert.equal(isBlockedIp(ip), false, ip);
    }
  });
  it("非法字面量保守拦截", () => {
    assert.equal(isBlockedIp("not-an-ip"), true);
    assert.equal(isBlockedIp(""), true);
  });
});

describe("assertProxyTarget", () => {
  it("私网 IP 字面量被拒", async () => {
    for (const u of ["http://192.168.1.1/a.png", "http://10.0.0.5/x.jpg", "http://127.0.0.1/x.png", "http://169.254.169.254/"]) {
      await assert.rejects(() => assertProxyTarget(u, pub), (e: any) => e instanceof ProxyImageError && e.status === 400, u);
    }
  });
  it("IPv6 回环字面量被拒", async () => {
    await assert.rejects(() => assertProxyTarget("http://[::1]/x.png", pub), (e: any) => e.status === 400);
  });
  it("非 http(s) 协议被拒", async () => {
    for (const u of ["file:///etc/passwd", "javascript:alert(1)", "data:image/png;base64,AAA", "ftp://h/a.png"]) {
      await assert.rejects(() => assertProxyTarget(u, pub), (e: any) => e.status === 400, u);
    }
  });
  it("非常规端口被拒", async () => {
    await assert.rejects(() => assertProxyTarget("https://cdn.example.com:8080/a.png", pub), (e: any) => e.status === 400);
    await assert.rejects(() => assertProxyTarget("http://cdn.example.com:3000/a.png", pub), (e: any) => e.status === 400);
  });
  it("DNS 多解析中混入私网 IP 即被拒", async () => {
    await assert.rejects(() => assertProxyTarget("https://evil.example.com/a.png", mixed), (e: any) => e.status === 400);
  });
  it("DNS 解析失败抛 502", async () => {
    await assert.rejects(() => assertProxyTarget("https://no-such-host.example/a.png", pub), (e: any) => e.status === 502);
  });
  it("正常公网 https 图片 URL 放行", async () => {
    const u = await assertProxyTarget("https://cdn.example.com/a.png?x=1", pub);
    assert.equal(u.hostname, "cdn.example.com");
  });
  it("空/非法输入被拒", async () => {
    await assert.rejects(() => assertProxyTarget("", pub), (e: any) => e.status === 400);
    await assert.rejects(() => assertProxyTarget("not a url", pub), (e: any) => e.status === 400);
  });
});

describe("fetchProxyImage（本地 stub 上游）", () => {
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  let srv: http.Server;
  let port = 0;
  const routes: Record<string, (req: any, res: any) => void> = {
    "/a.png": (_req, res) => { res.writeHead(200, { "Content-Type": "image/png", "Content-Length": PNG.length }); res.end(PNG); },
    "/t.txt": (_req, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("hello"); },
    "/big.png": (_req, res) => { res.writeHead(200, { "Content-Type": "image/png", "Content-Length": 9 * 1024 * 1024 }); res.end("x"); },
    "/redir": (_req, res) => { res.writeHead(302, { Location: "https://httpbin.org/image/png" }); res.end(); },
    "/redir-evil": (_req, res) => { res.writeHead(302, { Location: "http://169.254.169.254/" }); res.end(); },
    "/missing.png": (_req, res) => { res.writeHead(404); res.end(); },
  };
  before(async () => {
    await new Promise<void>((r) => {
      srv = http.createServer((req, res) => (routes[req.url || ""] || routes["/missing.png"])(req, res));
      srv.listen(0, "127.0.0.1", () => { port = (srv.address() as any).port; r(); });
    });
  });
  after(() => new Promise<void>((r) => { (srv as any).closeAllConnections?.(); srv.close(() => r()); }));
  const u = (p: string) => new URL(`http://127.0.0.1:${port}${p}`);
  const sig = AbortSignal.timeout(8000);

  it("正常图片返回字节 + content-type", async () => {
    const r = await fetchProxyImage(u("/a.png"), sig);
    assert.deepEqual(r.bytes, PNG);
    assert.equal(r.contentType, "image/png");
  });
  it("抓取携带浏览器请求头（防图床拦截程序 UA）", async () => {
    let ua = "";
    let accept = "";
    const s = http.createServer((req, res) => {
      ua = String(req.headers["user-agent"] || "");
      accept = String(req.headers["accept"] || "");
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": PNG.length });
      res.end(PNG);
    });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const p = (s.address() as any).port;
    await fetchProxyImage(new URL(`http://127.0.0.1:${p}/a.png`), sig);
    s.close();
    assert.match(ua, /Chrome\/\d+/);
    assert.match(accept, /image\//);
  });
  it("非图片 content-type 被拒", async () => {
    await assert.rejects(() => fetchProxyImage(u("/t.txt"), sig), (e: any) => e.status === 502);
  });
  it("超大 content-length 被拒", async () => {
    await assert.rejects(() => fetchProxyImage(u("/big.png"), sig), (e: any) => e.status === 502);
  });
  it("404 被拒", async () => {
    await assert.rejects(() => fetchProxyImage(u("/missing.png"), sig), (e: any) => e.status === 502);
  });
  it("公网重定向跟随（默认端口）", async () => {
    const r = await fetchProxyImage(u("/redir"), sig);
    assert.equal(r.contentType, "image/png");
    assert.ok(r.bytes.length > 100);
  });
  it("重定向到内网被拦截", async () => {
    await assert.rejects(() => fetchProxyImage(u("/redir-evil"), sig), (e: any) => e.status === 400);
  });
  it("超时被中止", async () => {
    const slow = http.createServer((_req, res) => setTimeout(() => { res.writeHead(200, { "Content-Type": "image/png" }); res.end(PNG); }, 3000));
    await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
    const p = (slow.address() as any).port;
    await assert.rejects(
      () => fetchProxyImage(new URL(`http://127.0.0.1:${p}/a.png`), AbortSignal.timeout(400)),
      (e: any) => e.status === 502
    );
    slow.close();
  });
});
