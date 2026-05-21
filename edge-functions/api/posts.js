import { getBucket } from '@edgeone/pages-blob';

function getStore(bucketName = 'notepro') {
  return getBucket(bucketName);
}

async function checkAuth(request, config) {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('='))
  );

  if (!cookies.auth_token || !config.sessions || !config.sessions[cookies.auth_token]) {
    return false;
  }

  const session = config.sessions[cookies.auth_token];
  return session.timeout > Date.now();
}

export default async function onRequest(context) {
  const request = context.request;

  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const store = getStore();
    const configData = await store.get('config.json').catch(() => null);

    if (!configData) {
      return new Response(JSON.stringify({ code: 10404, info: '系统未初始化' }), {
        status: 404,
        headers: CORS_HEADERS
      });
    }

    const config = JSON.parse(configData);
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'get';

    if (action === 'get') {
      const isLogin = await checkAuth(request, config);
      const postsData = await store.get('posts.json').catch(() => '[]');
      let posts = JSON.parse(postsData);

      const search = url.searchParams.get('search') || '';
      const sort = parseInt(url.searchParams.get('sort') || '0');
      const tag = url.searchParams.get('tag') || '';
      const page = parseInt(url.searchParams.get('page') || '0');
      const date = url.searchParams.get('date') || '';

      let filtered = posts.filter(p => !p.archive || isLogin);
      if (!isLogin) filtered = filtered.filter(p => !p.hidden);

      if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(p =>
          p.title.toLowerCase().includes(searchLower) ||
          p.content.toLowerCase().includes(searchLower)
        );
      }

      if (tag && tag !== '-1') {
        filtered = filtered.filter(p => p.tag === tag);
      }

      if (!isLogin) {
        const tagsData = await store.get('tags.json').catch(() => '[]');
        const tags = JSON.parse(tagsData);
        const hiddenTags = tags.filter(t => t.hidden).map(t => t.name);
        filtered = filtered.filter(p => !hiddenTags.includes(p.tag));
      }

      if (date) {
        filtered = filtered.filter(p => p.date.startsWith(date));
      }

      const viewDate = new Date(Date.now() - (config.viewRange || 0) * 86400000).toISOString().split('T')[0];
      if (config.viewRange > 0 && !isLogin) {
        filtered = filtered.filter(p => p.date >= viewDate);
      }

      let sorted = [...filtered];
      switch (sort) {
        case 0:
          sorted.sort((a, b) => {
            if (b.pin !== a.pin) return (b.pin || 0) - (a.pin || 0);
            return b.date.localeCompare(a.date);
          });
          break;
        case 1:
          sorted.sort((a, b) => b.date.localeCompare(a.date));
          break;
        case 2:
          sorted.sort((a, b) => a.date.localeCompare(b.date));
          break;
        default:
          sorted.sort((a, b) => b.date.localeCompare(a.date));
      }

      const postCount = config.postCount || 10;
      const totalItems = sorted.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / postCount));
      const offset = page * postCount;

      const paginated = sorted.slice(offset, offset + postCount);

      const result = paginated.map(p => ({
        id: p.id,
        date: p.date,
        tag: p.tag,
        title: p.title,
        content: p.content,
        hidden: p.hidden,
        pin: p.pin,
        weather: p.weather,
        location: p.location,
        pics: p.media,
        archive: p.archive
      }));

      return new Response(JSON.stringify({
        code: 10200,
        info: 'success',
        data: result,
        pagination: {
          current_page: page + 1,
          total_pages: totalPages,
          total_items: totalItems
        }
      }), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    const isLogin = await checkAuth(request, config);
    if (!isLogin) {
      return new Response(JSON.stringify({ code: 10401, info: '未经授权' }), {
        status: 401,
        headers: CORS_HEADERS
      });
    }

    const body = await request.json().catch(() => ({}));
    const { top = 0, hidden = 0, title, tag, content, media, weather, location, date } = body;

    const postsData = await store.get('posts.json').catch(() => '[]');
    const posts = JSON.parse(postsData);

    const maxId = posts.length > 0 ? Math.max(...posts.map(p => p.id)) : 0;
    const newId = maxId + 1;
    const finalTag = tag || config.defaultTag || '默认';
    const finalDate = date || new Date().toISOString().replace('T', ' ').substring(0, 16);

    const newPost = {
      id: newId,
      date: finalDate,
      tag: finalTag,
      title: title || '',
      content: content || '',
      top: parseInt(top),
      hidden: parseInt(hidden),
      weather: weather || {},
      location: location || {},
      media: media || {},
      archive: 0,
      created: Date.now()
    };

    posts.push(newPost);
    await store.put('posts.json', JSON.stringify(posts, null, 2));

    return new Response(JSON.stringify({ code: 10200, info: '创建成功', id: newId }), {
      status: 200,
      headers: CORS_HEADERS
    });
  } catch (error) {
    return new Response(JSON.stringify({ code: 10500, info: '请求失败: ' + error.message }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}