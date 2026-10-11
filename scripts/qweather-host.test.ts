// 和风 API Host 归一化/解析单元测试（node:test；跑：npx tsx --test scripts/qweather-host.test.ts）
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeQweatherHost } from "../server/util";

describe("normalizeQweatherHost", () => {
  it("专属域名通过并归一化为小写", () => {
    assert.equal(normalizeQweatherHost("abc123.def.qweatherapi.com"), "abc123.def.qweatherapi.com");
    assert.equal(normalizeQweatherHost("ABC123.DEF.QWEATHERAPI.COM"), "abc123.def.qweatherapi.com");
  });
  it("自动去掉 https:// 前缀与末尾斜线", () => {
    assert.equal(normalizeQweatherHost("https://abc123.def.qweatherapi.com/"), "abc123.def.qweatherapi.com");
    assert.equal(normalizeQweatherHost("http://abc123.def.qweatherapi.com"), "abc123.def.qweatherapi.com");
  });
  it("SSRF/注入类输入被拒绝", () => {
    assert.equal(normalizeQweatherHost("evil.com/../x"), null);
    assert.equal(normalizeQweatherHost("a b.com"), null);
    assert.equal(normalizeQweatherHost("host.com?x=1"), null);
    assert.equal(normalizeQweatherHost("host.com#frag"), null);
    assert.equal(normalizeQweatherHost("user@host.com"), null);
    assert.equal(normalizeQweatherHost("https://h.com/path"), null);
    assert.equal(normalizeQweatherHost(""), null);
    assert.equal(normalizeQweatherHost(null), null);
    assert.equal(normalizeQweatherHost("localhost"), null); // 裸词不接受
    assert.equal(normalizeQweatherHost(".bad.com"), null);
    assert.equal(normalizeQweatherHost("bad..com"), null);
  });
  it("IP:端口形式允许（便于本地 stub 测试）", () => {
    assert.equal(normalizeQweatherHost("127.0.0.1:8080"), "127.0.0.1:8080");
  });
});
