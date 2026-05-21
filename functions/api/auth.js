import { CORS_HEADERS, SUCCESS_RESPONSE, ERROR_RESPONSE, UNAUTHORIZED_RESPONSE } from '../_shared.js';

function getStore(bucketName = 'notepro') {
  return __STATIC_CONTENT.bucket(bucketName);
}

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generateToken() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
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

    if (request.method === "GET") {
      const url = new URL(request.url);
      const action = url.searchParams.get('action') || 'status';

      if (action === 'status') {
        const cookieHeader = request.headers.get('cookie') || '';
        const cookies = Object.fromEntries(
          cookieHeader.split(';').map(c => c.trim().split('='))
        );

        if (cookies.auth_token && config.sessions && config.sessions[cookies.auth_token]) {
          const session = config.sessions[cookies.auth_token];
          if (session.timeout > Date.now()) {
            return SUCCESS_RESPONSE({
              loggedIn: true,
              timeout: session.timeout,
              token: session.csrfToken
            }, '已登录');
          }
        }

        return SUCCESS_RESPONSE({ loggedIn: false }, '未登录');
      }

      return ERROR_RESPONSE(10400, '未知操作');
    }

    const body = await request.json().catch(() => ({}));
    const { action, password } = body;

    if (action === 'login') {
      if (!password || password.length < 4) {
        return ERROR_RESPONSE(10401, '密码长度不足或为空');
      }

      const inputHash = await sha256(config.passSalt + password + config.passSalt);

      if (inputHash !== config.passHash) {
        return ERROR_RESPONSE(10203, '密码错误，请重试');
      }

      const token = await generateToken();
      const csrfToken = await generateToken() + await generateToken();
      const timeout = Date.now() + (config.loginTimeout || 3600) * 1000;

      if (!config.sessions) {
        config.sessions = {};
      }

      config.sessions[token] = {
        csrfToken,
        timeout,
        created: Date.now()
      };

      await store.put('config.json', JSON.stringify(config, null, 2));

      const response = SUCCESS_RESPONSE({
        token: csrfToken,
        data: [
          config.pictureZip,
          config.pictureEncryption,
          config.defaultTag,
          config.cors
        ]
      }, '登录成功');

      response.headers.set('Set-Cookie',
        `auth_token=${token}; Path=/; HttpOnly; Max-Age=${config.loginTimeout || 3600}; SameSite=Lax`
      );

      return response;
    }

    if (action === 'logout') {
      const cookieHeader = request.headers.get('cookie') || '';
      const cookies = Object.fromEntries(
        cookieHeader.split(';').map(c => c.trim().split('='))
      );

      if (cookies.auth_token && config.sessions) {
        delete config.sessions[cookies.auth_token];
        await store.put('config.json', JSON.stringify(config, null, 2));
      }

      const response = SUCCESS_RESPONSE({}, '已退出登录');
      response.headers.set('Set-Cookie',
        'auth_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax'
      );

      return response;
    }

    return ERROR_RESPONSE(10400, '未知操作');
  } catch (error) {
    return ERROR_RESPONSE(10500, '请求失败: ' + error.message);
  }
}