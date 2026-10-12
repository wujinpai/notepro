import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = join(DATA_DIR, "notepro.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT,
  nickname TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  openid TEXT NOT NULL,
  unionid TEXT NOT NULL DEFAULT '',
  provider_nickname TEXT NOT NULL DEFAULT '',
  provider_avatar TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(provider, openid)
);
CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_codes ON email_codes(email, purpose);
CREATE TABLE IF NOT EXISTS slider_challenges (
  id TEXT PRIMARY KEY,
  answer INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tickets (
  token TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ua TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  weather TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public',
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  allow_comments INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by INTEGER
);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`);

// 迁移：notes 增加 share_token 列（随机不可猜；老数据在首次获取分享信息时按需生成）
const noteCols = db.prepare("PRAGMA table_info(notes)").all() as unknown as { name: string }[];
if (!noteCols.some((c) => c.name === "share_token")) {
  db.exec("ALTER TABLE notes ADD COLUMN share_token TEXT NOT NULL DEFAULT ''");
}
db.exec("CREATE INDEX IF NOT EXISTS idx_notes_share_token ON notes(share_token)");

// 迁移：notes 增加 allow_comments（默认开启）；新增 comments 表
if (!noteCols.some((c) => c.name === "allow_comments")) {
  db.exec("ALTER TABLE notes ADD COLUMN allow_comments INTEGER NOT NULL DEFAULT 1");
}
db.exec(`
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_note ON comments(note_id, created_at);
`);

// 迁移：notes 增加 view_count（详情真实渲染计数）；新增 site_views 按天站点访问计数
if (!noteCols.some((c) => c.name === "view_count")) {
  db.exec("ALTER TABLE notes ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0");
}
db.exec(`
CREATE TABLE IF NOT EXISTS site_views (
  day TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0
);
`);

export function getSetting(key: string, def = ""): string {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row ? row.value : def;
}
export function setSetting(key: string, value: string): void {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}
