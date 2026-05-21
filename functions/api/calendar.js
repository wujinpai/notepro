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
    const mode = url.searchParams.get('mode') || '';
    const dateParam = url.searchParams.get('date') || '';

    const calendarData = await store.get('calendar.json').catch(() => '{}');
    const calendar = JSON.parse(calendarData);

    const viewDate = new Date(Date.now() - (config.viewRange + 30) * 86400000);
    const blocked = config.viewRange > 0 && !isLogin;
    const viewYm = viewDate.getFullYear() * 100 + (viewDate.getMonth() + 1);

    if (mode === 'D') {
      const result = [];

      for (const [yearMonth, days] of Object.entries(calendar)) {
        const ym = parseInt(yearMonth);
        if (blocked && ym <= viewYm) continue;

        for (const day of Object.values(days)) {
          result.push(day);
        }
      }

      return new Response(JSON.stringify({ code: 10200, info: 'success', data: result }), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    const array = {};

    for (const [yearMonth, days] of Object.entries(calendar)) {
      const ym = parseInt(yearMonth);
      if (blocked && ym <= viewYm) continue;

      const year = Math.floor(ym / 100);
      const month = ym % 100;

      if (!array[year]) {
        array[year] = [];
      }

      const monthsWithPosts = new Set();
      for (const [day, count] of Object.entries(days)) {
        if (count > 0) {
          monthsWithPosts.add(parseInt(day));
        }
      }

      for (const monthNum of monthsWithPosts) {
        if (!array[year].includes(monthNum)) {
          array[year].push(monthNum);
        }
      }
    }

    return new Response(JSON.stringify({ code: 10200, info: 'success', data: array }), {
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