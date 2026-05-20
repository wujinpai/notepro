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

async function handleUpload(request, store) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file) {
    return jsonResponse({ error: "No file provided" }, 400);
  }

  const filename = file.name;
  const key = `media/${filename}`;

  const arrayBuffer = await file.arrayBuffer();
  await store.set(key, arrayBuffer);

  return jsonResponse(
    {
      url: `/api/upload?file=${encodeURIComponent(filename)}`,
      filename,
      key,
    },
    201
  );
}

async function handleGetFile(request, store) {
  const url = new URL(request.url);
  const filename = url.searchParams.get("file");
  if (!filename) {
    return jsonResponse({ error: "File parameter is required" }, 400);
  }

  const data = await store.get(`media/${filename}`, { type: "arrayBuffer" });
  if (!data) {
    return jsonResponse({ error: "File not found" }, 404);
  }

  const ext = filename.split(".").pop().toLowerCase();
  const contentTypes = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    pdf: "application/pdf",
  };

  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000",
      ...CORS_HEADERS,
    },
  });
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const store = getStore("notepro");

  try {
    switch (request.method) {
      case "POST":
        return await handleUpload(request, store);
      case "GET":
        return await handleGetFile(request, store);
      default:
        return jsonResponse({ error: "Method not allowed" }, 405);
    }
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
