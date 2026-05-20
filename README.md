# NotePro

一个基于 EdgeOne Pages 构建的个人笔记/博客应用，使用 EdgeOne Blob 存储数据。

## 特性

### 核心功能
- ✅ **文章管理** - 完整的 CRUD 操作
- ✅ **Markdown 编辑器** - 支持实时预览、数学公式
- ✅ **标签系统** - 按标签管理文章
- ✅ **日历视图** - 按日期查看文章
- ✅ **全文搜索** - 快速找到文章
- ✅ **媒体管理** - 图片/视频上传与展示
- ✅ **个人资料** - 自定义头像、背景、签名
- ✅ **社交链接** - 添加微博、知乎、GitHub 等
- ✅ **主题系统** - 11色自定义主题
- ✅ **登录保护** - 密码访问控制

### 技术栈
| 层级 | 技术 |
|------|------|
| 前端 | React 18 + Vite |
| 后端 | EdgeOne Pages Functions |
| 存储 | EdgeOne Blob |
| Markdown | marked.js + KaTeX |
| 图标 | 自定义 Icomoon 字体 |

## 快速开始

### 1. 部署到 EdgeOne Pages

1. 登录 [腾讯云 EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages)
2. 点击「新建项目」
3. 选择「GitHub 导入」，授权并选择 `wujinpai/notepro` 仓库
4. 填写项目配置：
   - **构建命令**: `npm run build`
   - **输出目录**: `dist`
   - **Functions 目录**: `functions`
5. 点击「部署」

### 2. 初始化应用

部署完成后，首次访问会提示初始化。需要设置密码：

```bash
# 使用 curl 初始化（或使用 Postman 等工具）
curl -X POST https://你的域名/api/init \
  -H "Content-Type: application/json" \
  -d '{"password": "你的密码"}'
```

也可以在浏览器控制台执行：

```javascript
fetch('/api/init', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: '你的密码' })
}).then(r => r.json()).then(console.log)
```

### 3. 登录使用

访问你的网站，点击个人资料卡上的「🔑」图标，输入密码登录。

## 配置说明

### 主题配色

可自定义的 11 种颜色：

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `main` | 主色 | `#39393a` |
| `background` | 背景 | `#f7f7f7` |
| `card` | 卡片 | `#ffffff` |
| `card2` | 隐藏卡片 | `#9891cd` |
| `title` | 标题 | `#39393a` |
| `content` | 内容 | `#39393a` |
| `desc` | 描述 | `#7a7a7a` |
| `tool` | 工具 | `#f1f1f1` |
| `button` | 按钮 | `#29adff` |
| `input` | 输入框 | `#707070` |
| `tag` | 标签 | `#8f8f8f` |

### 默认配置

完整配置参见 [functions/api/init.js](functions/api/init.js)：

```javascript
{
  // 个人设置
  personal: {
    avatar: "/assets/img/default-avatar.webp",
    background: "/assets/img/default-background.webp",
    nickname: "NotePro",
    signature: "记录美好的每一天",
    email: "hello@example.com",
    social: []
  },
  // 网站设置
  website: {
    name: "NotePro",
    description: "一个简洁的个人笔记/博客应用",
    keywords: "笔记,博客,个人",
    postPerPage: 10,
    viewRange: 30
  },
  // 内容设置
  content: {
    tags: [],
    defaultTag: "默认",
    enableCalendarSearch: true,
    enableImageCompression: false,
    enableEncryption: false
  },
  // 系统设置
  system: {
    timezone: "Asia/Shanghai",
    zoomLevel: 100,
    locationAPI: "",
    weatherAPI: "",
    footer: "Powered by NotePro"
  },
  // 主题设置
  colors: { /* 11种颜色 */ }
}
```

## API 文档

所有 API 路径前缀为 `/api`。

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/auth/status` | 获取登录状态 |
| POST | `/auth/login` | 登录 |
| POST | `/auth/logout` | 登出 |
| PUT | `/auth/password` | 修改密码 |

### 文章

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/posts` | 获取文章列表 |
| GET | `/posts?id=xxx` | 获取单篇文章 |
| POST | `/posts` | 创建文章 |
| PUT | `/posts` | 更新文章 |
| DELETE | `/posts?id=xxx` | 删除文章 |

`GET /posts` 参数：
- `page` - 页码
- `perPage` - 每页条数
- `tag` - 标签筛选
- `date` - 日期筛选 (YYYY-MM-DD)
- `search` - 关键词搜索
- `showHidden` - 是否显示隐藏文章（仅登录）

### 标签

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/tags` | 获取所有标签 |

### 日历

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/calendar?month=YYYYMM` | 获取某月日历数据 |

### 设置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/settings` | 获取所有设置 |
| PUT | `/settings` | 更新设置 |

### 上传

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/upload` | 上传媒体文件 |
| DELETE | `/upload` | 删除文件 |

### 初始化

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/init` | 初始化应用（仅未初始化） |

## 数据结构

### 文章
```javascript
{
  id: "1716221400000",
  date: "2026-05-20 18:30:00",
  tag: "默认",
  title: "我的第一篇文章",
  content: "# Hello\n\n这是我的第一篇 NotePro 文章！",
  pin: false,
  hidden: false,
  weather: "sunny",
  location: "北京",
  media: [],
  archive: false
}
```

### 标签
```javascript
{
  name: "技术",
  count: 15,
  hidden: false,
  visitCount: 0
}
```

## Blob 存储路径

| 路径 | 说明 |
|------|------|
| `posts/index.json` | 文章索引 |
| `posts/{id}.json` | 单篇文章 |
| `tags/index.json` | 标签列表 |
| `calendar/{YYYYMM}.json` | 某月日历数据 |
| `settings/config.json` | 全局设置 |
| `media/{filename}` | 媒体文件 |

## EdgeOne Blob 文档

- [Blob 存储文档](https://cloud.tencent.com/document/product/1552/131425)
- [Pages Functions 文档](https://cloud.tencent.com/document/product/1552/127365)

## 本地开发

### 安装依赖
```bash
npm install
```

### 启动开发服务器
```bash
npm run dev
```

### 生产构建
```bash
npm run build
```

### 预览构建
```bash
npm run preview
```

注意：本地开发时无法使用 EdgeOne Blob 存储，需要实际部署到 EdgeOne Pages 才能测试完整功能。

## 项目结构

```
notepro/
├── functions/          # EdgeOne Pages Functions
│   └── api/
│       ├── auth.js     # 认证 API
│       ├── calendar.js # 日历 API
│       ├── init.js     # 初始化 API
│       ├── posts.js    # 文章 API
│       ├── settings.js # 设置 API
│       ├── tags.js     # 标签 API
│       └── upload.js   # 上传 API
├── public/             # 静态资源
│   └── assets/
│       ├── css/
│       ├── fonts/
│       └── img/
├── src/
│   ├── components/     # React 组件
│   ├── context/        # Context
│   ├── styles/         # 样式
│   ├── utils/          # 工具函数
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── index.html
├── vite.config.js
├── package.json
└── README.md
```

## 许可证

MIT License

---

Powered by EdgeOne Pages & Blob Storage ✨
