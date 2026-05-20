import { getStore } from "@edgeone/pages-blob";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function generateSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const DEFAULT_SETTINGS = {
  personal: {
    nickname: "NotePro",
    avatar: "",
    signature: "A simple note & blog application",
    bio: "",
  },
  website: {
    title: "NotePro",
    description: "A simple note & blog application powered by EdgeOne",
    footer: "Powered by NotePro",
    favicon: "",
    logo: "",
  },
  content: {
    postsPerPage: 10,
    dateFormat: "YYYY-MM-DD HH:mm",
    timezone: "Asia/Shanghai",
    language: "zh-CN",
    markdown: true,
  },
  system: {
    passwordHash: "",
    passwordSalt: "",
    allowRegister: false,
    maintenance: false,
  },
  colors: {
    main: "#39393a",
    background: "#f7f7f7",
    card: "#ffffff",
    card2: "#9891cd",
    title: "#39393a",
    content: "#39393a",
    desc: "#7a7a7a",
    tool: "#f1f1f1",
    button: "#29adff",
    input: "#707070",
    tag: "#8f8f8f",
  },
};

async function handleInit(request, store) {
  const existing = await store.get("settings/config.json", {
    type: "json",
    consistency: "strong",
  });
  if (existing && existing.system && existing.system.passwordHash) {
    return jsonResponse({ error: "Application already initialized" }, 400);
  }

  const body = await request.json().catch(() => ({}));
  const password = body.password || "admin123";

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  const settings = {
    ...DEFAULT_SETTINGS,
    personal: { ...DEFAULT_SETTINGS.personal, ...(body.personal || {}) },
    website: { ...DEFAULT_SETTINGS.website, ...(body.website || {}) },
    content: { ...DEFAULT_SETTINGS.content, ...(body.content || {}) },
    system: {
      ...DEFAULT_SETTINGS.system,
      ...(body.system || {}),
      passwordHash,
      passwordSalt: salt,
    },
    colors: { ...DEFAULT_SETTINGS.colors, ...(body.colors || {}) },
  };

  await store.setJSON("settings/config.json", settings);
  await store.setJSON("posts/index.json", []);
  await store.setJSON("tags/index.json", []);

  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  await store.setJSON(`calendar/${yearMonth}.json`, {});

  return jsonResponse(
    {
      message: "Application initialized successfully",
      settings: {
        ...settings,
        system: { ...settings.system, passwordHash: "***" },
      },
    },
    201
  );
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const store = getStore("notepro");

  try {
    if (request.method === "POST") {
      return await handleInit(request, store);
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
