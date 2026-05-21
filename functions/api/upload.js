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
    const isLogin = await checkAuth(request, config);

    if (!isLogin) {
      return UNAUTHORIZED_RESPONSE();
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
          return ERROR_RESPONSE(10400, '没有文件');
        }

        fileData = await file.arrayBuffer();
        fileName = file.name || 'image.webp';
        fileType = file.type || 'image/webp';
      } else {
        const body = await request.json().catch(() => ({}));
        const { data, name, type } = body;

        if (!data) {
          return ERROR_RESPONSE(10400, '没有文件数据');
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
        return ERROR_RESPONSE(10400, '不支持的文件格式');
      }

      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 6);
      const ext = fileName.split('.').pop() || 'webp';
      const newFileName = `${timestamp}${random}.${ext}`;

      const mediaDir = `media/${new Date().toISOString().substring(0, 7)}`;
      const fullPath = `${mediaDir}/${newFileName}`;

      await store.put(fullPath, fileData);

      const imageUrl = `/media/${new Date().toISOString().substring(0, 7)}/${newFileName}`;

      return SUCCESS_RESPONSE({
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
      });
    }

    if (action === 'avatar' || action === 'background') {
      const body = await request.json().catch(() => ({}));
      const { data } = body;

      if (!data) {
        return ERROR_RESPONSE(10400, '没有文件数据');
      }

      const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
      const fileData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

      const fileName = action === 'avatar' ? 'avatar.webp' : 'background.webp';
      const filePath = `config/${fileName}`;

      await store.put(filePath, fileData);

      config.cache = Date.now();
      await store.put('config.json', JSON.stringify(config, null, 2));

      return SUCCESS_RESPONSE({ url: `/${filePath}` });
    }

    return ERROR_RESPONSE(10400, '未知操作');
  } catch (error) {
    return ERROR_RESPONSE(10500, '上传失败: ' + error.message);
  }
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}