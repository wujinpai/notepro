// 分享海报工具函数（纯函数，便于 node:test 单测）

// 判断图片 URL 是否同源。外链图跨域无 CORS 头会使 html-to-image 整体抛错，
// 海报渲染时直接换成占位块；OAuth 头像（GitHub/QQ 外链）同理。
export function isSameOriginUrl(src: string): boolean {
  if (!src) return false;
  if (/^(data|blob):/i.test(src)) return true;
  try {
    return new URL(src, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

// 海报 PNG 空白检测：抽样像素方差，过低视为抓取失败
//（捕获节点若被屏外 fixed/隐藏，html-to-image 会把克隆节点画到画布外 → 空白图但 resolve）
export const isBlankPng = (url: string): Promise<boolean> =>
  new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 32; c.height = 32;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return res(false);
        ctx.drawImage(img, 0, 0, 32, 32);
        const d = ctx.getImageData(0, 0, 32, 32).data;
        let diff = 0;
        for (let i = 0; i < d.length; i += 32) {
          diff += Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) + Math.abs(d[i + 3] - d[3]);
        }
        res(diff < 2000);
      } catch {
        res(false);
      }
    };
    img.onerror = () => res(false);
    img.src = url;
  });
