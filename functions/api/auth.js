import { getStore } from "@edgeone/pages-blob";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

async function handleGetLoginStatus(request, store) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return jsonResponse({ authenticated: false });
  }

  const token = authHeader.slice(7);
  const storedToken = await store.get("auth/token.json", {
    type: "json",
    consistency: "strong",
  }).catch(() => null);

  if (!storedToken || storedToken.token !== token) {
    return jsonResponse({ authenticated: false });
  }

  if (storedToken.expiresAt && Date.now() > storedToken.expiresAt) {
    await store.delete("auth/token.json").catch(() => {});
    return jsonResponse({ authenticated: false });
  }

  return jsonResponse({ authenticated: true });
}

async function handleLogin(request, store) {
  const body = await request.json().catch(() => ({}));
  const { password } = body;

  if (!password) {
    return jsonResponse({ error: "Password is required" }, 400);
  }

  const settings = (await store.get("settings/config.json", { type: "json", consistency: "strong" })).catch(() => ({})) || {};
  const systemSettings = settings.system || {};
  const storedHash = systemSettings.passwordHash;
  const salt = systemSettings.passwordSalt || "notepro-default-salt";

  if (!storedHash) {
    return jsonResponse({ error: "Application not initialized" }, 400);
  }

  const inputHash = await hashPassword(password, salt);

  if (inputHash !== storedHash) {
    return jsonResponse({ error: "Invalid password" }, 401);
  }

  const token = generateToken();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

  await store.setJSON("auth/token.json", { token, expiresAt });

  return jsonResponse({ token, expiresAt });
}

export async function onRequest(context) {
  const request = context.request;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const store = getStore("notepro");

  try {
    switch (request.method) {
      case "GET":
        return await handleGetLoginStatus(request, store);
      case "POST":
        return await handleLogin(request, store);
      default:
        return jsonResponse({ error: "Method not allowed" }, 405);
    }
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}