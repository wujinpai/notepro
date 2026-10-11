// 腾讯逆地理 address_component 解析单元测试（node:test；跑：npx tsx --test scripts/tencent-geo.test.ts）
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTencentAddressComponent } from "../server/util";

describe("parseTencentAddressComponent", () => {
  it("区县优先：达川区", () => {
    const r = parseTencentAddressComponent({ nation: "中国", province: "四川省", city: "达州市", district: "达川区" } as never);
    assert.deepEqual(r, { district: "达川区", city: "达州", province: "四川省", label: "达川区" });
  });
  it("无区县时退到地级市（去尾市）", () => {
    const r = parseTencentAddressComponent({ province: "四川省", city: "成都市", district: "" } as never);
    assert.equal(r?.label, "成都");
    assert.equal(r?.city, "成都");
  });
  it("只有省时兜底", () => {
    const r = parseTencentAddressComponent({ province: "四川省" } as never);
    assert.equal(r?.label, "四川省");
  });
  it("繁体區统一为区", () => {
    const r = parseTencentAddressComponent({ province: "四川省", city: "达州市", district: "达川區" } as never);
    assert.equal(r?.label, "达川区");
  });
  it("空/缺失返回 null", () => {
    assert.equal(parseTencentAddressComponent(null), null);
    assert.equal(parseTencentAddressComponent(undefined), null);
    assert.equal(parseTencentAddressComponent({} as never), null);
  });
});
