import { getStore } from "@edgeone/pages-blob";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function updateTags(store, oldTag, newTag) {
  const tags = (await store.get("tags/index.json", { type: "json", consistency: "strong" })).catch(() => []) || [];

  if (oldTag) {
    const oldEntry = tags.find((t) => t.name === oldTag);
    if (oldEntry) {
      oldEntry.count -= 1;
      if (oldEntry.count <= 0) {
        const idx = tags.indexOf(oldEntry);
        tags.splice(idx, 1);
      }
    }
  }

  if (newTag) {
    const newEntry = tags.find((t) => t.name === newTag);
    if (newEntry) {
      newEntry.count += 1;
    } else {
      tags.push({ name: newTag, count: 1, hidden: false, visitCount: 0 });
    }
  }

  await store.setJSON("tags/index.json", tags);
}

async function updateCalendar(store, dateStr, delta) {
  const match = dateStr.match(/^(\d{4})-(\d{2})/);
  if (!match) return;
  const [, year, month] = match;
  const key = `calendar/${year}${month}.json`;
  const cal = (await store.get(key, { type: "json", consistency: "strong" })).catch(() => {}) || {};
  const day = parseInt(dateStr.split("-")[2], 10);
  cal[day] = (cal[day] || 0) + delta;
  if (cal[day] <= 0) delete cal[day];
  await store.setJSON(key, cal);
}

async function handleGet(request, store) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    const posts = (await store.get("posts/index.json", { type: "json", consistency: "strong" })).catch(() => []) || [];
    const post = posts.find((p) => p.id === id);
    if (!post) return jsonResponse({ error: "Post not found" }, 404);
    return jsonResponse({ post });
  }

  const posts = (await store.get("posts/index.json", { type: "json" })).catch(() => []) || [];
  let filtered = posts.filter((p) => !p.hidden);

  const tag = url.searchParams.get("tag");
  if (tag) {
    filtered = filtered.filter((p) => p.tag === tag);
  }

  const search = url.searchParams.get("search");
  if (search) {
    const lower = search.toLowerCase();
    filtered = filtered.filter(
      (p) =>
        (p.title && p.title.toLowerCase().includes(lower)) ||
        (p.content && p.content.toLowerCase().includes(lower))
    );
  }

  const date = url.searchParams.get("date");
  if (date) {
    filtered = filtered.filter((p) => p.date && p.date.startsWith(date));
  }

  const pinned = filtered.filter((p) => p.pin);
  const unpinned = filtered.filter((p) => !p.pin);
  const sorted = [...pinned, ...unpinned].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = parseInt(url.searchParams.get("pageSize") || "10", 10);
  const start = (page - 1) * pageSize;
  const paginated = sorted.slice(start, start + pageSize);

  return jsonResponse({
    posts: paginated,
    total: sorted.length,
    page,
    pageSize,
    totalPages: Math.ceil(sorted.length / pageSize),
  });
}

async function handlePost(request, store) {
  const body = await request.json().catch(() => ({}));
  const { title, content, tag, pin, hidden, weather, location, media, archive } = body;

  if (!title || !content) {
    return jsonResponse({ error: "Title and content are required" }, 400);
  }

  const posts = (await store.get("posts/index.json", { type: "json", consistency: "strong" })).catch(() => []) || [];
  const now = new Date();
  const id = now.getTime().toString(36) + Math.random().toString(36).slice(2, 8);
  const date = now.toISOString();

  const post = {
    id,
    date,
    tag: tag || "",
    title,
    content,
    pin: pin || false,
    hidden: hidden || false,
    weather: weather || "",
    location: location || "",
    media: media || [],
    archive: archive || "",
  };

  posts.push(post);
  await store.setJSON("posts/index.json", posts);

  if (tag) {
    await updateTags(store, null, tag);
  }

  await updateCalendar(store, date.slice(0, 10), 1);

  return jsonResponse({ post }, 201);
}

async function handlePut(request, store) {
  const body = await request.json().catch(() => ({}));
  const { id, title, content, tag, pin, hidden, weather, location, media, archive } = body;

  if (!id) {
    return jsonResponse({ error: "Post id is required" }, 400);
  }

  const posts = (await store.get("posts/index.json", { type: "json", consistency: "strong" })).catch(() => []) || [];
  const index = posts.findIndex((p) => p.id === id);
  if (index === -1) {
    return jsonResponse({ error: "Post not found" }, 404);
  }

  const oldPost = posts[index];
  const oldTag = oldPost.tag;
  const newTag = tag !== undefined ? tag : oldTag;

  posts[index] = {
    ...oldPost,
    ...(title !== undefined && { title }),
    ...(content !== undefined && { content }),
    ...(tag !== undefined && { tag }),
    ...(pin !== undefined && { pin }),
    ...(hidden !== undefined && { hidden }),
    ...(weather !== undefined && { weather }),
    ...(location !== undefined && { location }),
    ...(media !== undefined && { media }),
    ...(archive !== undefined && { archive }),
  };

  await store.setJSON("posts/index.json", posts);

  if (oldTag !== newTag) {
    await updateTags(store, oldTag, newTag);
  }

  return jsonResponse({ post: posts[index] });
}

async function handleDelete(request, store) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return jsonResponse({ error: "Post id is required" }, 400);
  }

  const posts = (await store.get("posts/index.json", { type: "json", consistency: "strong" })).catch(() => []) || [];
  const index = posts.findIndex((p) => p.id === id);
  if (index === -1) {
    return jsonResponse({ error: "Post not found" }, 404);
  }

  const deleted = posts.splice(index, 1)[0];
  await store.setJSON("posts/index.json", posts);

  if (deleted.tag) {
    await updateTags(store, deleted.tag, null);
  }

  if (deleted.date) {
    await updateCalendar(store, deleted.date.slice(0, 10), -1);
  }

  return jsonResponse({ success: true, deleted });
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
        return await handleGet(request, store);
      case "POST":
        return await handlePost(request, store);
      case "PUT":
        return await handlePut(request, store);
      case "DELETE":
        return await handleDelete(request, store);
      default:
        return jsonResponse({ error: "Method not allowed" }, 405);
    }
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}