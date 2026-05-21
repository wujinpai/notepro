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

export async function onRequest(context) {
  const request = context.request;

  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (request.method === "OPTIONS") {
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
    const isLogin = await checkAuth(request, config);
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'get';

    if (action === 'get') {
      const sort = parseInt(url.searchParams.get('sort') || '0');

      const tagsData = await store.get('tags.json').catch(() => '[]');
      let tags = JSON.parse(tagsData);

      if (!isLogin) {
        tags = tags.filter(t => !t.hidden);
      }

      let sorted = [...tags];
      switch (sort) {
        case 1:
          sorted.sort((a, b) => b.name.localeCompare(a.name));
          break;
        case 2:
          sorted.sort((a, b) => (a.count_visit || 0) - (b.count_visit || 0));
          break;
        case 3:
          sorted.sort((a, b) => (b.count_visit || 0) - (a.count_visit || 0));
          break;
        case 4:
          sorted.sort((a, b) => (b.hidden || 0) - (a.hidden || 0));
          break;
        default:
          sorted.sort((a, b) => a.name.localeCompare(b.name));
      }

      const postsData = await store.get('posts.json').catch(() => '[]');
      const posts = JSON.parse(postsData);

      const result = sorted.map(t => {
        const count = isLogin ? t.count : t.count_visit;
        if (count === 0 && !isLogin) return null;

        return {
          id: t.id || 0,
          tag: t.name,
          count: count || 0,
          hidden: t.hidden
        };
      }).filter(t => t !== null);

      if (!isLogin) {
        const encPicCount = posts.filter(p => p.media && JSON.stringify(p.media).includes('Enc_')).length;
        if (encPicCount > 0) {
          result.push({
            id: -999,
            tag: '加密图片',
            count: encPicCount,
            hidden: 0
          });
        }
      }

      return new Response(JSON.stringify({ code: 10200, info: 'success', data: result }), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    if (!isLogin) {
      return new Response(JSON.stringify({ code: 10401, info: '未经授权' }), {
        status: 401,
        headers: CORS_HEADERS
      });
    }

    const body = await request.json().catch(() => ({}));
    const { tag, mode, value } = body;

    if (mode === 'rename') {
      const tagsData = await store.get('tags.json').catch(() => '[]');
      let tags = JSON.parse(tagsData);

      const targetTag = tags.find(t => t.name === value);
      if (targetTag) {
        const sourceTag = tags.find(t => t.name === tag);
        if (sourceTag) {
          targetTag.count = (targetTag.count || 0) + (sourceTag.count || 0);
          targetTag.count_visit = (targetTag.count_visit || 0) + (sourceTag.count_visit || 0);
        }
        tags = tags.filter(t => t.name !== tag);
      } else {
        const tagIndex = tags.findIndex(t => t.name === tag);
        if (tagIndex !== -1) {
          tags[tagIndex].name = value;
        }
      }

      await store.put('tags.json', JSON.stringify(tags, null, 2));

      const postsData = await store.get('posts.json').catch(() => '[]');
      const posts = JSON.parse(postsData);
      posts.forEach(p => {
        if (p.tag === tag) p.tag = value;
      });
      await store.put('posts.json', JSON.stringify(posts, null, 2));

      return new Response(JSON.stringify({ code: 10200, info: '重命名成功' }), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    if (mode === 'hidden') {
      const tagsData = await store.get('tags.json').catch(() => '[]');
      let tags = JSON.parse(tagsData);

      const tagIndex = tags.findIndex(t => t.name === tag);
      if (tagIndex === -1) {
        return new Response(JSON.stringify({ code: 10404, info: '标签不存在' }), {
          status: 404,
          headers: CORS_HEADERS
        });
      }

      tags[tagIndex].hidden = tags[tagIndex].hidden ? 0 : 1;
      await store.put('tags.json', JSON.stringify(tags, null, 2));

      return new Response(JSON.stringify({ code: 10200, info: '切换成功', data: tags[tagIndex].hidden }), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    if (mode === 'delete') {
      const tagsData = await store.get('tags.json').catch(() => '[]');
      let tags = JSON.parse(tagsData);

      tags = tags.filter(t => t.name !== tag);
      await store.put('tags.json', JSON.stringify(tags, null, 2));

      const postsData = await store.get('posts.json').catch(() => '[]');
      let posts = JSON.parse(postsData);
      posts = posts.filter(p => p.tag !== tag);
      await store.put('posts.json', JSON.stringify(posts, null, 2));

      return new Response(JSON.stringify({ code: 10200, info: '删除成功' }), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    return new Response(JSON.stringify({ code: 10400, info: '未知操作' }), {
      status: 400,
      headers: CORS_HEADERS
    });
  } catch (error) {
    return new Response(JSON.stringify({ code: 10500, info: '请求失败: ' + error.message }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}