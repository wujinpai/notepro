import { getStore } from "@edgeone/pages-blob";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function handleGet(request, store) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month");

  if (!month) {
    return jsonResponse({ error: "Month parameter is required (format: YYYYMM)" }, 400);
  }

  if (!/^\d{6}$/.test(month)) {
    return jsonResponse({ error: "Invalid month format, use YYYYMM" }, 400);
  }

  const key = `calendar/${month}.json`;
  const calendar = (await store.get(key, { type: "json" })) || {};
  return jsonResponse({ month, calendar });
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const store = getStore("notepro");

  try {
    if (request.method === "GET") {
      return await handleGet(request, store);
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
