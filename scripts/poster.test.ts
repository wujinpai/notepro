// 海报工具函数单元测试（node:test；跑：npx tsx --test scripts/poster.test.ts）
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// poster-util 只在调用时访问 window，这里给一个浏览器替身
before(() => {
  (globalThis as any).window = { location: new URL("https://jisu.cn/") };
});

const { isSameOriginUrl } = await import("../src/poster-util");

describe("isSameOriginUrl", () => {
  it("站内相对路径为同源", () => {
    assert.equal(isSameOriginUrl("/uploads/a.png"), true);
    assert.equal(isSameOriginUrl("/avatar/1.png"), true);
  });
  it("同 origin 的绝对 URL 为同源", () => {
    assert.equal(isSameOriginUrl("https://jisu.cn/uploads/a.png"), true);
    assert.equal(isSameOriginUrl("//jisu.cn/uploads/a.png"), true);
  });
  it("外链为非同源", () => {
    assert.equal(isSameOriginUrl("https://example.com/x.jpg"), false);
    assert.equal(isSameOriginUrl("https://evil-jisu.cn/x.jpg"), false);
    assert.equal(isSameOriginUrl("http://jisu.cn/x.jpg"), false); // 协议不同 origin 不同
  });
  it("data/blob URL 视为可用", () => {
    assert.equal(isSameOriginUrl("data:image/png;base64,iVBOR"), true);
    assert.equal(isSameOriginUrl("blob:https://jisu.cn/uuid"), true);
  });
  it("空串为非同源", () => {
    assert.equal(isSameOriginUrl(""), false);
  });
});
