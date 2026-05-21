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

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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

    if (!isLogin) {
      return new Response(JSON.stringify({ code: 10401, info: '未经授权' }), {
        status: 401,
        headers: CORS_HEADERS
      });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'upload';

    if (action === 'upload') {
      const contentType = request.headers.get('content-type') || '';
      let fileData, fileName, fileType;

      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file) {
          return new Response(JSON.stringify({ code: 10400, info: '没有文件' }), {
            status: 400,
            headers: CORS_HEADERS
          });
        }

        fileData = await file.arrayBuffer();
        fileName = file.name || 'image.webp';
        fileType = file.type || 'image/webp';
      } else {
        const body = await request.json().catch(() => ({}));
        const { data, name, type } = body;

        if (!data) {
          return new Response(JSON.stringify({ code: 10400, info: '没有文件数据' }), {
            status: 400,
            headers: CORS_HEADERS
          });
        }

        const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
        fileData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        fileName = name || `image_${Date.now()}.webp`;
        fileType = type || 'image/webp';
      }

      const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
        'video/mp4', 'video/webm', 'video/ogg'
      ];

      if (!allowedTypes.includes(fileType)) {
        return new Response(JSON.stringify({ code: 10400, info: '不支持的文件格式' }), {
          status: 400,
          headers: CORS_HEADERS
        });
      }

      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 6);
      const ext = fileName.split('.').pop() || 'webp';
      const newFileName = `${timestamp}${random}.${ext}`;

      const mediaDir = `media/${new Date().toISOString().substring(0, 7)}`;
      const fullPath = `${mediaDir}/${newFileName}`;

      await store.put(fullPath, fileData);

      const imageUrl = `/media/${new Date().toISOString().substring(0, 7)}/${newFileName}`;

      return new Response(JSON.stringify({
        code: 10200,
        info: 'success',
        url: imageUrl,
        name: `${timestamp}${random}`,
        ext: ext,
        zip: 'local',
        zip_size: formatBytes(fileData.byteLength),
        sourceName: fileName,
        imageInfo: {
          resolution: 'unknown',
          size: formatBytes(fileData.byteLength)
        }
      }), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    if (action === 'avatar' || action === 'background') {
      const body = await request.json().catch(() => ({}));
      const { data } = body;

      if (!data) {
        return new Response(JSON.stringify({ code: 10400, info: '没有文件数据' }), {
          status: 400,
          headers: CORS_HEADERS
        });
      }

      const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
      const fileData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

      const fileName = action === 'avatar' ? 'avatar.webp' : 'background.webp';
      const filePath = `config/${fileName}`;

      await store.put(filePath, fileData);

      config.cache = Date.now();
      await store.put('config.json', JSON.stringify(config, null, 2));

      return new Response(JSON.stringify({ code: 10200, info: 'success', url: `/${filePath}` }), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    return new Response(JSON.stringify({ code: 10400, info: '未知操作' }), {
      status: 400,
      headers: CORS_HEADERS
    });
  } catch (error) {
    return new Response(JSON.stringify({ code: 10500, info: '上传失败: ' + error.message }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}