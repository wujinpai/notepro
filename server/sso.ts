import { db, getSetting, setSetting } from "./db.js";
import { decryptSecret, encryptSecret, sha256, randomToken } from "./util.js";

db.exec(`CREATE TABLE IF NOT EXISTS sso_codes (
  code_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
)`);
// 定期清理：只保留 24 小时内的码
setInterval(() => {
  try { db.prepare("DELETE FROM sso_codes WHERE created_at<?").run(Date.now() - 24 * 3600_000); } catch { /* ignore */ }
}, 3600_000).unref?.();

export interface SsoConfig {
  enabled: boolean;
  secret: string; // 明文仅服务端内部使用
  hasSecret: boolean;
  redirectUris: string[];
}

export function getSsoConfig(): SsoConfig {
  const secEnc = getSetting("sso_secret_enc");
  const uris = getSetting("sso_redirect_uris", "").split("\n").map((s) => s.trim()).filter(Boolean);
  return {
    enabled: getSetting("sso_enabled") === "1" && !!secEnc && uris.length > 0,
    secret: secEnc ? decryptSecret(secEnc) : "",
    hasSecret: !!secEnc,
    redirectUris: uris,
  };
}

export function saveSsoConfig(enabled: boolean, secretPlain: string | undefined, redirectUris: string) {
  setSetting("sso_enabled", enabled ? "1" : "0");
  if (secretPlain) setSetting("sso_secret_enc", encryptSecret(secretPlain));
  setSetting("sso_redirect_uris", redirectUris.split("\n").map((s) => s.trim()).filter(Boolean).join("\n"));
}

export function isRedirectAllowed(uri: string): boolean {
  const cfg = getSsoConfig();
  if (!cfg.enabled) return false;
  try {
    const u = new URL(uri);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return cfg.redirectUris.some((allow) => {
      // 精确匹配，或允许子路径
      return uri === allow || uri.startsWith(allow.endsWith("/") ? allow : allow + "/");
    });
  } catch { return false; }
}

// 发一次性码（10 分钟有效，单次使用）
export function issueSsoCode(userId: number): string {
  const code = randomToken(32);
  db.prepare("INSERT INTO sso_codes(code_hash,user_id,created_at,used) VALUES(?,?,?,0)")
    .run(sha256(code), userId, Date.now());
  return code;
}

// 验码：secret 对 + 码有效 → 返回用户 id，码作废
export function verifySsoCode(code: string, secret: string): number | null {
  const cfg = getSsoConfig();
  if (!cfg.enabled || !cfg.secret || secret !== cfg.secret) return null;
  const row = db.prepare("SELECT user_id,created_at,used FROM sso_codes WHERE code_hash=?").get(sha256(code)) as
    { user_id: number; created_at: number; used: number } | undefined;
  if (!row || row.used || Date.now() - row.created_at > 10 * 60_000) return null;
  db.prepare("UPDATE sso_codes SET used=1 WHERE code_hash=?").run(sha256(code));
  return row.user_id;
}
