import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SESSION_SECRET = process.env.SESSION_SECRET || "";
if (!SESSION_SECRET && process.env.NODE_ENV === "production") {
  console.warn("[warn] SESSION_SECRET 未设置：密钥加密与会话签名将使用不安全默认值，请在 .env 中配置。");
}
const effectiveSecret = SESSION_SECRET || "notepro-dev-secret-change-me";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("hex");

// ---- 密码：scrypt salt:hash ----
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const calc = scryptSync(pw, salt, 64);
  const orig = Buffer.from(hash, "hex");
  return calc.length === orig.length && timingSafeEqual(calc, orig);
}

// ---- 秘密加密：SESSION_SECRET 经 scrypt 派生 AES-256-GCM 密钥（与工坊系列产品口径一致）----
const encKey = scryptSync(effectiveSecret, "notepro-settings", 32);
export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}
export function decryptSecret(stored: string): string {
  if (!stored) return "";
  try {
    const [v, ivB, tagB, dataB] = stored.split(":");
    if (v !== "v1") return "";
    const decipher = createDecipheriv("aes-256-gcm", encKey, Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

// ---- 腾讯位置服务逆地理 address_component 解析：district（区县原样）→ city（去尾"市"）→ province ----
export function parseTencentAddressComponent(ac: { province?: string; city?: string; district?: string } | null | undefined): { district: string; city: string; province: string; label: string } | null {
  if (!ac) return null;
  const district = String(ac.district || "").replace(/區/g, "区");
  const city = String(ac.city || "").replace(/市$/, "");
  const province = String(ac.province || "");
  const label = district || city || province;
  if (!label) return null;
  return { district, city, province, label };
}

// ---- 签名（OAuth state / cookie）----
export function sign(data: string): string {
  return createHash("sha256").update(effectiveSecret + "|" + data).digest("hex").slice(0, 32);
}
export function signPayload(obj: unknown): string {
  const body = Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${body}.${sign(body)}`;
}
export function verifyPayload<T>(token: string): T | null {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || sign(body) !== sig) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export const maskEmail = (email: string | null): string => {
  if (!email) return "";
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}${"*".repeat(Math.max(1, name.length - head.length))}@${domain}`;
};
