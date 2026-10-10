# NotePro 多用户笔记广场

从零构建的多用户笔记应用，对标单人笔记流参考程序并全面超越：多用户注册/登录、弹窗式账号体系、自研滑块验证、邮箱验证码、GitHub / QQ 第三方登录、完整用户中心与管理员后台。

- 技术栈：React + Vite + Express + TypeScript，Node 24（`node:sqlite` 单文件库），单 Docker 镜像
- 界面：全中文，Google Material 色板，棱角分明（2–4px 小圆角），自动跟随系统明暗 + 手动切换，PC 与 390px 手机零横向溢出（已实测）

## 本地运行

```bash
npm install
npm run build        # 构建前端 dist/public + 服务端 dist/server
SESSION_SECRET=请改成长随机串 npm start   # http://localhost:3001
```

开发模式：`npm run dev`（Vite 前端 :5173，/api 与 /uploads 代理到 :3001）+ `npm run dev:server`。

第一个注册的用户自动成为管理员。未配置 SMTP 时，邮箱验证码打印在服务端日志 `[email-code]` 行里（开发/自检用）。

## Docker 部署

```bash
docker build -t notepro .
docker run -d --restart unless-stopped --name notepro -p 18082:3001 \
  --env-file .env \
  -v /opt/apps/notepro/data:/app/data \
  -v /opt/apps/notepro/storage:/app/storage \
  notepro
```

`.env` 只需 `SESSION_SECRET` 与可选 `PORT`（见 `.env.example`）。数据卷：`data`（SQLite）、`storage`（上传图片）。

## 功能概览

- **笔记广场**：全部用户公开笔记混排，作者头像/昵称、时间、天气/位置标记、标签、摘要与图片；标签筛选、关键词搜索、日历归档（月历显示每日篇数，点日期过滤）、置顶优先；登录后可切「我的」
- **发帖/编辑**：Markdown 编辑 + 实时预览（先转义后渲染，链接/图片仅允许 http(s) 与站内路径，XSS 安全）、标签多建、图片上传（MIME/扩展名/5MB 校验）、置顶/公开/私密/归档、删除确认
- **弹窗登录**：一个对话框三态切换（登录/注册/忘记密码），不跳整页
  - 注册：用户名唯一 + 邮箱验证码（6 位/10 分钟/60 秒重发/邮箱全站唯一）+ 滑块 + 密码 ≥6 位
  - 登录：用户名或邮箱 + 密码 + 滑块；忘记密码：邮箱验证码重置（邮箱不存在返回统一成功，重置后全部会话失效）
  - 滑块为自研服务端拼图：缺口坐标不下发，校验容差 ±8，一次性 ticket 被登录/注册/发码消费
- **第三方登录**：GitHub、QQ（OAuth2），管理员后台配置后登录弹窗才显示按钮；回调 state 防 CSRF；未绑自动建号不卡首次进入；QQ 同时记录 openid 与 unionid
- **用户中心**：头像上传（方形预览）、昵称/签名、脱敏邮箱、账号 ID 与注册时间；换绑邮箱（当前密码 + 新邮箱验证码）；改密用邮箱验证码免原密码；第三方绑定/解绑；登录会话列表可下线其他设备
- **管理员后台**（第一个注册用户即管理员）：概览计数、用户管理（禁用即时下线并下架其公开笔记、删除级联、设/取消管理员且保护最后一个管理员）、内容管理（下架/删除任意笔记）、站点设置（名称/副标题/SEO/页脚/开放注册/Logo 上传）、邮箱设置（SMTP 加密存储、保存即时生效、发送测试邮件）、第三方设置（密钥加密存储只回 hasSecret、页面显示可粘贴的回调地址、低成本配置自检）

## 安全

- 密码 scrypt 哈希；会话随机 token 哈希入库、30 天有效，可单会话下线
- SMTP 密码与 OAuth 密钥 AES-256-GCM 加密存储（密钥由 SESSION_SECRET 派生），任何接口不回明文
- 验证码 purpose（register/reset/bind/changepw）隔离不可串用；登录/发码有限流

## 验证

```bash
npm run typecheck
npm run build
npm test             # scripts/e2e.mjs：68 项真实 HTTP 断言（滑块/注册/发帖/改密/后台/OAuth 本地替身全流程）
node scripts/render-check.mjs   # 需另备 playwright-core 与 chromium 无头浏览器：量 1366/390 核心页横向溢出
```

## 第三方登录上线须知

1. GitHub：Settings → Developer settings → OAuth Apps 新建，Homepage 填站点地址，Authorization callback URL 填后台「第三方登录设置」页显示的 `<站点>/api/auth/oauth/github/callback`；把 Client ID / Secret 填回后台并启用。
2. QQ：QQ 互联（connect.qq.com）建网站应用，回调填同页显示的 `.../api/auth/oauth/qq/callback`；把 App ID / App Key 填回后台并启用，需要 unionid 时在 QQ 互联申请对应权限。
3. 「站点地址」取站点设置里的站点地址，未填时按请求 Host 推导（反代后请确保 X-Forwarded-Host/Proto 正确，或直接填写站点地址）。
