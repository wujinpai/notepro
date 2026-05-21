import { CORS_HEADERS, SUCCESS_RESPONSE, ERROR_RESPONSE, UNAUTHORIZED_RESPONSE } from '../_shared.js';

function getStore(bucketName = 'notepro') {
  return __STATIC_CONTENT.bucket(bucketName);
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

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const store = getStore();
    const configData = await store.get('config.json').catch(() => null);

    if (!configData) {
      return ERROR_RESPONSE(10404, '系统未初始化');
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
      const id = url.searchParams.get('id') || '';
      const mode = parseInt(url.searchParams.get('mode') || '0');

      if (!isLogin && config.siteVisibility === 'private') {
        return SUCCESS_RESPONSE({
          data: [],
          pagination: { public: '1' }
        });
      }

      let filtered = posts.filter(p => !p.archive || isLogin);

      if (!isLogin) {
        filtered = filtered.filter(p => !p.hidden);
      }

      if (search) {
        const searchLower = search.toLowerCase();
        if (mode === 0) {
          filtered = filtered.filter(p =>
            p.title.toLowerCase().includes(searchLower) ||
            p.content.toLowerCase().includes(searchLower)
          );
        } else if (mode === 1) {
          const keywords = search.split(',').map(k => k.trim()).filter(k => k);
          filtered = filtered.filter(p =>
            keywords.every(kw =>
              p.title.toLowerCase().includes(kw.toLowerCase()) ||
              p.content.toLowerCase().includes(kw.toLowerCase()) ||
              (p.location && p.location.toLowerCase().includes(kw.toLowerCase())) ||
              (p.tag && p.tag.toLowerCase().includes(kw.toLowerCase()))
            )
          );
        }
      }

      if (tag && tag !== '-1') {
        if (tag === '-999') {
          filtered = filtered.filter(p => p.media && JSON.stringify(p.media).includes('Enc_'));
        } else {
          filtered = filtered.filter(p => p.tag === tag);
        }
      }

      if (!isLogin) {
        const tagsData = await store.get('tags.json').catch(() => '[]');
        const tags = JSON.parse(tagsData);
        const hiddenTags = tags.filter(t => t.hidden).map(t => t.name);
        filtered = filtered.filter(p => !hiddenTags.includes(p.tag));
      }

      if (date) {
        if (config.calendarSearch === 'only') {
          filtered = filtered.filter(p => p.date.startsWith(date));
        } else {
          filtered = filtered.filter(p => p.date >= date);
        }
      }

      if (sort === 4 && !isLogin) {
        filtered = [];
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
        case 3:
          if (!isLogin) return UNAUTHORIZED_RESPONSE();
          sorted.sort((a, b) => {
            if (b.hidden !== a.hidden) return (b.hidden || 0) - (a.hidden || 0);
            return b.id - a.id;
          });
          break;
        case 4:
          sorted.sort((a, b) => a.id - b.id);
          break;
      }

      const postCount = config.postCount || 10;
      const totalItems = sorted.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / postCount));
      const offset = page * postCount;

      let continueData = false;
      if (offset + postCount < totalItems) {
        const checkDate = sorted[offset + postCount]?.date;
        if (checkDate && checkDate < viewDate) {
          continueData = true;
        }
      }

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
        archive: p.archive,
        is_hidden: config.postHiddenTip
      }));

      return SUCCESS_RESPONSE({
        data: result,
        pagination: {
          current_page: page + 1,
          total_pages: totalPages,
          total_items: totalItems,
          items_per_page: postCount,
          has_previous: page > 0,
          has_next: !continueData && page + 1 < totalPages,
          avg: id ? (continueData ? config.viewRange : 0) : -1
        }
      });
    }

    const isLogin = await checkAuth(request, config);

    if (!isLogin) {
      return UNAUTHORIZED_RESPONSE();
    }

    if (action === 'new') {
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

      await updateTag(store, finalTag, 1, parseInt(hidden));
      await updateCalendar(store, finalDate.substring(0, 7), parseInt(finalDate.split('-')[2]));

      return SUCCESS_RESPONSE({ id: newId }, '创建成功');
    }

    if (action === 'update') {
      const body = await request.json().catch(() => ({}));
      const { id, top, hidden, title, tag, content, media, weather, location, date, archive } = body;

      const postsData = await store.get('posts.json').catch(() => '[]');
      const posts = JSON.parse(postsData);
      const postIndex = posts.findIndex(p => p.id === parseInt(id));

      if (postIndex === -1) {
        return ERROR_RESPONSE(10404, '文章不存在');
      }

      const oldPost = posts[postIndex];

      if (tag !== oldPost.tag) {
        await updateTag(store, tag, 1, parseInt(hidden));
        await updateTag(store, oldPost.tag, -1, parseInt(oldPost.hidden));
      } else if (hidden !== oldPost.hidden) {
        await updateTag(store, tag, 0, parseInt(hidden) - parseInt(oldPost.hidden));
      }

      if (date !== oldPost.date) {
        await updateCalendar(store, date.substring(0, 7), parseInt(date.split('-')[2]));
        await updateCalendar(store, oldPost.date.substring(0, 7), parseInt(oldPost.date.split('-')[2]));
      }

      posts[postIndex] = {
        ...oldPost,
        top: parseInt(top ?? oldPost.top),
        hidden: parseInt(hidden ?? oldPost.hidden),
        title: title ?? oldPost.title,
        tag: tag ?? oldPost.tag,
        content: content ?? oldPost.content,
        media: media ?? oldPost.media,
        weather: weather ?? oldPost.weather,
        location: location ?? oldPost.location,
        date: date ?? oldPost.date,
        archive: parseInt(archive ?? oldPost.archive)
      };

      await store.put('posts.json', JSON.stringify(posts, null, 2));

      return SUCCESS_RESPONSE({}, '更新成功');
    }

    if (action === 'delete') {
      const body = await request.json().catch(() => ({}));
      const { id } = body;

      const postsData = await store.get('posts.json').catch(() => '[]');
      const posts = JSON.parse(postsData);
      const postIndex = posts.findIndex(p => p.id === parseInt(id));

      if (postIndex === -1) {
        return ERROR_RESPONSE(10404, '文章不存在');
      }

      const deletedPost = posts[postIndex];
      posts.splice(postIndex, 1);
      await store.put('posts.json', JSON.stringify(posts, null, 2));

      await updateTag(store, deletedPost.tag, -1, deletedPost.hidden ? 0 : -1);
      await updateCalendar(store, deletedPost.date.substring(0, 7), parseInt(deletedPost.date.split('-')[2]), -1);

      return SUCCESS_RESPONSE({}, '删除成功');
    }

    return ERROR_RESPONSE(10400, '未知操作');
  } catch (error) {
    return ERROR_RESPONSE(10500, '请求失败: ' + error.message);
  }
}

async function updateTag(store, tagName, mode, visitChange = 0) {
  const tagsData = await store.get('tags.json').catch(() => '[]');
  let tags = JSON.parse(tagsData);

  const tagIndex = tags.findIndex(t => t.name === tagName);

  if (tagIndex === -1) {
    tags.push({
      name: tagName,
      count: mode > 0 ? 1 : 0,
      count_visit: visitChange > 0 ? 1 : 0,
      hidden: 0
    });
  } else {
    tags[tagIndex].count = Math.max(0, (tags[tagIndex].count || 0) + mode);
    tags[tagIndex].count_visit = Math.max(0, (tags[tagIndex].count_visit || 0) + visitChange);

    if (tags[tagIndex].count === 0) {
      tags.splice(tagIndex, 1);
    }
  }

  await store.put('tags.json', JSON.stringify(tags, null, 2));
}

async function updateCalendar(store, yearMonth, day, mode = 1) {
  const calendarData = await store.get('calendar.json').catch(() => '{}');
  let calendar = JSON.parse(calendarData);

  if (!calendar[yearMonth]) {
    const daysInMonth = new Date(yearMonth + '-01');
    calendar[yearMonth] = {};
    for (let i = 1; i <= 31; i++) {
      calendar[yearMonth][i] = 0;
    }
  }

  calendar[yearMonth][day] = Math.max(0, (calendar[yearMonth][day] || 0) + mode);

  await store.put('calendar.json', JSON.stringify(calendar, null, 2));
}