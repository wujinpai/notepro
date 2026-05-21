import { getBucket } from '@edgeone/pages-blob';

function getStore(bucketName = 'notepro') {
  return getBucket(bucketName);
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
            return new Response(JSON.stringify({
              code: 10200,
              info: '已登录',
              loggedIn: true,
              timeout: session.timeout,
              token: session.csrfToken
            }), {
              status: 200,
              headers: CORS_HEADERS
            });
          }
        }

        return new Response(JSON.stringify({ code: 10200, info: '未登录', loggedIn: false }), {
          status: 200,
          headers: CORS_HEADERS
        });
      }

      return new Response(JSON.stringify({ code: 10400, info: '未知操作' }), {
        status: 400,
        headers: CORS_HEADERS
      });
    }

    const body = await request.json().catch(() => ({}));
    const { action, password } = body;

    if (action === 'login') {
      if (!password || password.length < 4) {
        return new Response(JSON.stringify({ code: 10401, info: '密码长度不足或为空' }), {
          status: 400,
          headers: CORS_HEADERS
        });
      }

      const inputHash = await sha256(config.passSalt + password + config.passSalt);

      if (inputHash !== config.passHash) {
        return new Response(JSON.stringify({ code: 10203, info: '密码错误，请重试' }), {
          status: 200,
          headers: CORS_HEADERS
        });
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

      const response = new Response(JSON.stringify({
        code: 10200,
        info: '登录成功',
        token: csrfToken,
        data: [
          config.pictureZip,
          config.pictureEncryption,
          config.defaultTag,
          config.cors
        ]
      }), {
        status: 200,
        headers: CORS_HEADERS
      });

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

      const response = new Response(JSON.stringify({ code: 10200, info: '已退出登录' }), {
        status: 200,
        headers: CORS_HEADERS
      });
      response.headers.set('Set-Cookie',
        'auth_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax'
      );

      return response;
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