// WMO 天气码映射单元测试（node:test；跑：npx tsx --test scripts/weather.test.ts）
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WMO_ZH, wmoToZh } from "../src/weather";

describe("wmoToZh", () => {
  it("全量官方码逐项映射正确", () => {
    const expected: Record<number, string> = {
      0: "晴",
      1: "以晴为主", 2: "多云", 3: "阴",
      45: "雾", 48: "雾凇",
      51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨",
      56: "冻毛毛雨", 57: "冻毛毛雨",
      61: "小雨", 63: "中雨", 65: "大雨",
      66: "冻雨", 67: "冻雨",
      71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
      80: "阵雨", 81: "阵雨", 82: "暴雨",
      85: "阵雪", 86: "阵雪",
      95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "雷阵雨伴冰雹",
    };
    for (const [k, v] of Object.entries(expected)) {
      assert.equal(wmoToZh(Number(k)), v, `code ${k}`);
    }
  });

  it("61 是小雨不是晴（回归：用户质疑项）", () => {
    assert.equal(wmoToZh(61), "小雨");
    assert.notEqual(wmoToZh(61), "晴");
  });

  it("未知码/非数字不兜底成晴，返回 undefined", () => {
    assert.equal(wmoToZh(999), undefined);
    assert.equal(wmoToZh(undefined), undefined);
    assert.equal(wmoToZh(null), undefined);
    assert.equal(wmoToZh("61"), undefined); // 字符串码不隐式命中数字 key
    assert.equal(wmoToZh(NaN), undefined);
  });

  it("表内无多余缺失：键集合与官方码集合一致", () => {
    const official = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
    assert.deepEqual(Object.keys(WMO_ZH).map(Number).sort((a, b) => a - b), official);
  });
});
