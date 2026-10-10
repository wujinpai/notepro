import { getSetting, setSetting } from "./db.js";
import { decryptSecret, encryptSecret } from "./util.js";
export { setSetting };

export type Provider = "github" | "qq";
export const PROVIDERS: Provider[] = ["github", "qq"];

export interface ProviderConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string; // 明文仅在服务端内部使用
  hasSecret: boolean;
}

export function getProviderConfig(p: Provider): ProviderConfig {
  const id = getSetting(`oauth_${p}_id`);
  const secEnc = getSetting(`oauth_${p}_secret_enc`);
  return {
    enabled: getSetting(`oauth_${p}_enabled`) === "1" && !!id && !!secEnc,
    clientId: id,
    clientSecret: decryptSecret(secEnc),
    hasSecret: !!secEnc,
  };
}
export function saveProviderConfig(p: Provider, enabled: boolean, clientId: string, secretPlain: string | undefined) {
  // secretPlain 为 undefined 表示留空不改
  setSetting(`oauth_${p}_enabled`, enabled ? "1" : "0");
  setSetting(`oauth_${p}_id`, clientId);
  if (secretPlain) setSetting(`oauth_${p}_secret_enc`, encryptSecret(secretPlain));
}

function githubBase() {
  return {
    auth: process.env.OAUTH_GITHUB_BASE || "https://github.com",
    api: process.env.OAUTH_GITHUB_API_BASE || "https://api.github.com",
  };
}
function qqBase() {
  return process.env.OAUTH_QQ_BASE || "https://graph.qq.com";
}

export function authorizeUrl(p: Provider, cfg: ProviderConfig, redirectUri: string, state: string): string {
  if (p === "github") {
    const { auth } = githubBase();
    return `${auth}/login/oauth/authorize?client_id=${encodeURIComponent(cfg.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent("read:user user:email")}&state=${encodeURIComponent(state)}`;
  }
  return `${qqBase()}/oauth2.0/authorize?response_type=code&client_id=${encodeURIComponent(cfg.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
}

export interface ProviderProfile {
  openid: string;
  unionid: string;
  nickname: string;
  avatar: string;
  email: string;
}

async function httpText(url: string, init?: RequestInit): Promise<string> {
  const r = await fetch(url, init);
  return r.text();
}

export async function exchangeProfile(p: Provider, cfg: ProviderConfig, code: string, redirectUri: string): Promise<ProviderProfile> {
  if (p === "github") {
    const { auth, api } = githubBase();
    const tokenText = await httpText(`${auth}/login/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: redirectUri }).toString(),
    });
    let access = "";
    try { access = (JSON.parse(tokenText) as { access_token?: string }).access_token || ""; } catch { /* fallthrough */ }
    if (!access) {
      const m = tokenText.match(/access_token=([^&]+)/);
      access = m ? decodeURIComponent(m[1]) : "";
    }
    if (!access) throw new Error("GitHub 授权失败：未取得 access_token");
    const userText = await httpText(`${api}/user`, { headers: { Authorization: `Bearer ${access}`, "User-Agent": "NotePro" } });
    const gu = JSON.parse(userText) as { id: number; login: string; name?: string; avatar_url?: string; email?: string };
    return { openid: String(gu.id), unionid: "", nickname: gu.name || gu.login || "", avatar: gu.avatar_url || "", email: gu.email || "" };
  }
  // QQ：token 返回 querystring
  const base = qqBase();
  const tokenText = await httpText(`${base}/oauth2.0/token?grant_type=authorization_code&client_id=${encodeURIComponent(cfg.clientId)}&client_secret=${encodeURIComponent(cfg.clientSecret)}&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}&fmt=json`);
  let access = "";
  try { access = (JSON.parse(tokenText) as { access_token?: string }).access_token || ""; } catch { /* fallthrough */ }
  if (!access) {
    const m = tokenText.match(/access_token=([^&]+)/);
    access = m ? decodeURIComponent(m[1]) : "";
  }
  if (!access) throw new Error("QQ 授权失败：未取得 access_token");
  const meText = await httpText(`${base}/oauth2.0/me?access_token=${encodeURIComponent(access)}&unionid=1&fmt=json`);
  let meJson = meText;
  const cb = meText.match(/\{[\s\S]*\}/);
  if (cb) meJson = cb[0];
  const me = JSON.parse(meJson) as { openid: string; unionid?: string };
  const infoText = await httpText(`${base}/user/get_user_info?access_token=${encodeURIComponent(access)}&oauth_consumer_key=${encodeURIComponent(cfg.clientId)}&openid=${encodeURIComponent(me.openid)}`);
  const info = JSON.parse(infoText) as { nickname?: string; figureurl_qq_2?: string; figureurl_qq_1?: string };
  return {
    openid: me.openid,
    unionid: me.unionid || "",
    nickname: info.nickname || "",
    avatar: info.figureurl_qq_2 || info.figureurl_qq_1 || "",
    email: "",
  };
}
