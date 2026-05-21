import { getBucket } from '@edgeone/pages-blob';

function getStore(bucketName = 'notepro') {
  return getBucket(bucketName);
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
    const calendarData = await store.get('calendar.json').catch(() => '{}');
    const calendar = JSON.parse(calendarData);

    const array = {};
    for (const [yearMonth, days] of Object.entries(calendar)) {
      const ym = parseInt(yearMonth);
      const year = Math.floor(ym / 100);

      if (!array[year]) {
        array[year] = [];
      }

      for (const [day, count] of Object.entries(days)) {
        if (count > 0 && !array[year].includes(parseInt(day))) {
          array[year].push(parseInt(day));
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