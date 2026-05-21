import { getStore } from '@edgeone/pages-blob';

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
    const store = getStore('notepro');
    const configData = await store.get('config.json').catch(() => null);

    if (!configData) {
      return new Response(JSON.stringify({ code: 10404, info: '系统未初始化' }), {
        status: 404,
        headers: CORS_HEADERS
      });
    }

    const body = await request.json().catch(() => ({}));
    const { data, name, type } = body;

    if (!data) {
      return new Response(JSON.stringify({ code: 10400, info: '没有文件数据' }), {
        status: 400,
        headers: CORS_HEADERS
      });
    }

    const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
    const fileData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 6);
    const ext = (name || 'image').split('.').pop() || 'webp';
    const newFileName = `${timestamp}${random}.${ext}`;

    const mediaDir = `media/${new Date().toISOString().substring(0, 7)}`;
    const fullPath = `${mediaDir}/${newFileName}`;

    await store.set(fullPath, fileData);

    const imageUrl = `/media/${new Date().toISOString().substring(0, 7)}/${newFileName}`;

    return new Response(JSON.stringify({
      code: 10200,
      info: 'success',
      url: imageUrl,
      name: `${timestamp}${random}`,
      ext: ext
    }), {
      status: 200,
      headers: CORS_HEADERS
    });
  } catch (error) {
    return new Response(JSON.stringify({ code: 10500, info: '上传失败: ' + error.message }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}