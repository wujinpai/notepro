import { getStore } from "@edgeone/pages-blob";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function handleGet(request, store) {
  const settings = (await store.get("settings/config.json", { type: "json" })) || {};
  return jsonResponse({ settings });
}

async function handlePut(request, store) {
  const body = await request.json();
  const { settings } = body;

  if (!settings || typeof settings !== "object") {
    return jsonResponse({ error: "Settings object is required" }, 400);
  }

  const current =
    (await store.get("settings/config.json", { type: "json", consistency: "strong" })) || {};
  const merged = { ...current, ...settings };
  await store.setJSON("settings/config.json", merged);

  return jsonResponse({ settings: merged });
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const store = getStore("notepro");

  try {
    switch (request.method) {
      case "GET":
        return await handleGet(request, store);
      case "PUT":
        return await handlePut(request, store);
      default:
        return jsonResponse({ error: "Method not allowed" }, 405);
    }
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
