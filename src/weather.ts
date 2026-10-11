// WMO 天气码 → 中文（Open-Meteo current.weather_code）
// 纯模块：无 React 依赖，便于单元测试
export const WMO_ZH: Record<number, string> = {
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

/** 天气码 → 中文描述；未知/非数字码返回 undefined（调用方不回填，不兜底成"晴"） */
export function wmoToZh(code: unknown): string | undefined {
  return typeof code === "number" ? WMO_ZH[code] : undefined;
}
