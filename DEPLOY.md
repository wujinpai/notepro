# 部署指南

## 前置条件

- 一个腾讯云账号
- EdgeOne Pages 服务已开通

## 部署步骤

### 方式一：通过 EdgeOne Pages 控制台部署（推荐）

#### 1. 准备仓库

确保您的代码已推送到 GitHub 仓库（例如：`https://github.com/wujinpai/notepro`）

#### 2. 访问 EdgeOne Pages 控制台

登录 [腾讯云 EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages)

#### 3. 创建新项目

点击「新建项目」按钮，选择「代码托管」模式。

#### 4. 授权与配置

1. **选择仓库**：选择刚才推送的仓库 `wujinpai/notepro`
2. **选择分支**：选择 `main` 分支
3. **填写项目配置**：
   ```
   项目名称：notepro
   框架预设：Vite
   构建命令：npm run build
   输出目录：dist
   Functions 目录：functions
   ```
4. **点击「部署」**

#### 5. 等待部署完成

部署通常需要 1-3 分钟，完成后您会获得一个访问地址，例如：`https://notepro-xxxx.pages.edgeone.dev`

#### 6. 初始化应用

访问部署后的地址，首次访问需要初始化。使用以下任一方式初始化：

**方式 A：浏览器控制台（推荐）**
1. 打开浏览器访问部署地址
2. 按 F12 打开开发者工具
3. 在控制台执行：
   ```javascript
   fetch('/api/init', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ password: '您的密码' })
   }).then(r => r.json()).then(console.log)
   ```

**方式 B：curl**
```bash
curl -X POST https://您的域名/api/init \
  -H "Content-Type: application/json" \
  -d '{"password": "您的密码"}'
```

#### 7. 开始使用

刷新页面，点击个人资料卡右下角的「🔑」图标，输入刚才设置的密码登录！

---

### 方式二：使用 EdgeOne CLI 部署

#### 1. 安装 EdgeOne CLI

```bash
npm install -g @edgeone/cli
```

#### 2. 登录

```bash
eo login
```

按照提示完成登录。

#### 3. 创建项目

```bash
eo init --name notepro
```

#### 4. 配置项目

编辑 `eo.config.json`：

```json
{
  "name": "notepro",
  "build": {
    "command": "npm run build",
    "outputDir": "dist",
    "functionsDir": "functions"
  },
  "framework": "vite"
}
```

#### 5. 部署

```bash
eo deploy
```

---

## 自定义域名

部署成功后，您可以绑定自己的域名：

1. 进入项目设置
2. 点击「自定义域名」
3. 输入您的域名（例如：`notepro.yourdomain.com`）
4. 按照提示完成 DNS 解析配置
5. 配置 SSL 证书（EdgeOne Pages 提供免费证书）

---

## 常见问题

### Q: 初始化失败怎么办？

A: 检查以下几点：
- 确保是首次部署（未初始化过）
- 密码长度至少 6 位
- 检查浏览器控制台的网络请求是否成功

### Q: 如何重置密码？

A: 使用已登录状态进入「设置 > 系统」，修改密码。

如果忘记密码：
1. 使用 `listStores` API 删除 `notepro` 命名空间
2. 重新初始化应用（会丢失所有数据！）

### Q: 可以查看 Blob 存储的数据吗？

A: EdgeOne Pages 控制台提供 Blob 只读浏览功能：
1. 进入项目
2. 点击「存储」标签
3. 选择「Blob」

可以查看命名空间、目录结构和对象列表。

### Q: 本地开发如何测试？

A: 本地开发时无法使用 Blob 存储，需要部署到 EdgeOne Pages 测试完整功能。

建议开发流程：
1. 本地快速开发界面（Mock 数据）
2. 部署到 EdgeOne Pages 测试完整功能

### Q: 免费版有配额限制吗？

A: EdgeOne Pages 免费版配额：
- 存储空间：1 GB
- 请求次数：10万次/天
- Functions 调用：50万次/月
- 流量：10 GB/月

具体配额以 [EdgeOne 定价页面](https://buy.cloud.tencent.com/edgeone) 为准。

### Q: 如何备份数据？

A: 使用 Blob API 导出数据：
- 获取所有文章：读取 `posts/index.json` 及每篇 `posts/{id}.json`
- 获取设置：读取 `settings/config.json`
- 获取标签：读取 `tags/index.json`
- 获取日历：读取所有 `calendar/{YYYYMM}.json`

可以写一个脚本定期备份这些数据。

---

## 性能优化

### 图片压缩

在「设置 > 内容」中开启「图片压缩」，上传时会自动压缩图片。

### CDN 缓存

所有静态资源自动通过 EdgeOne 全球 CDN 加速，无需额外配置。

### 一致性控制

- 读取操作默认使用「最终一致」（边缘缓存，毫秒级响应）
- 可在代码中切换为「强一致」（实时读取主存储）

---

## 开发调试

### 查看 Functions 日志

1. 进入项目
2. 点击「日志」标签
3. 选择「Functions 日志」

### 本地调试 Functions

EdgeOne Pages 提供本地调试工具：

```bash
eo dev
```

会模拟 EdgeOne Pages 环境，包括 Blob 存储模拟。

---

## 更新应用

### 更新代码并重新部署

1. 修改代码后提交到 GitHub
2. EdgeOne Pages 会自动检测变更并触发部署
3. 部署过程通常 1-2 分钟

### 手动触发部署

1. 进入项目设置
2. 点击「部署」→「重新部署」

---

## 故障排查

### 部署失败

1. 检查构建日志
2. 确保 `package.json` 中的依赖正确
3. 确保构建输出目录为 `dist`

### Functions 5xx 错误

1. 查看 Functions 日志
2. 检查 Blob 操作是否有权限
3. 确保代码符合 Node.js 18+ 语法

### 登录无反应

1. 检查密码是否正确
2. 检查浏览器控制台错误
3. 尝试清除浏览器 Cookie

---

如需更多帮助，请参考：
- [EdgeOne Pages 文档](https://cloud.tencent.com/document/product/1552/127365)
- [EdgeOne Blob 文档](https://cloud.tencent.com/document/product/1552/131425)
