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

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

function generateUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
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
      if (!isLogin) {
        return new Response(JSON.stringify({ code: 10401, info: '未经授权' }), {
          status: 401,
          headers: CORS_HEADERS
        });
      }

      return new Response(JSON.stringify({
        code: 10200,
        info: 'success',
        data: {
          siteTitle: config.siteTitle,
          siteDescription: config.siteDescription,
          siteKeywords: config.siteKeywords,
          siteTimeZone: config.siteTimeZone,
          siteLang: config.siteLang,
          siteCharset: config.siteCharset,
          siteZoom: config.siteZoom,
          userName: config.userName,
          userSign: config.userSign,
          userEmail: config.userEmail,
          mainColor: config.mainColor,
          backgroundColor: config.backgroundColor,
          cardColor: config.cardColor,
          card2Color: config.card2Color,
          titleColor: config.titleColor,
          contentColor: config.contentColor,
          descColor: config.descColor,
          toolColor: config.toolColor,
          buttonColor: config.buttonColor,
          inputColor: config.inputColor,
          tagColor: config.tagColor,
          postCount: config.postCount,
          postHiddenTip: config.postHiddenTip,
          viewRange: config.viewRange,
          defaultTag: config.defaultTag,
          visitMode: config.visitMode,
          backTop: config.backTop,
          pictureZip: config.pictureZip,
          pictureEncryption: config.pictureEncryption,
          calendarSearch: config.calendarSearch,
          siteVisibility: config.siteVisibility,
          locationApiUrl: config.locationApiUrl,
          locationApiPath: config.locationApiPath,
          locationApiKey: config.locationApiKey,
          locationShowMode: config.locationShowMode,
          weatherApiUrl: config.weatherApiUrl,
          weatherApiPath: config.weatherApiPath,
          weatherApiKey: config.weatherApiKey,
          defaultLocation: config.defaultLocation,
          loginTimeout: config.loginTimeout,
          siteMap: config.siteMap,
          copyright: config.copyright,
          cors: config.cors,
          pseudoStatic: config.pseudoStatic,
          displayTip: config.displayTip,
          uid: config.uid,
          version: config.version
        }
      }), {
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

    if (action === 'update') {
      const body = await request.json().catch(() => ({}));
      const { key, value } = body;

      if (!key) {
        return new Response(JSON.stringify({ code: 10400, info: '缺少参数' }), {
          status: 400,
          headers: CORS_HEADERS
        });
      }

      config[key] = value;
      config.cache = Date.now();

      await store.put('config.json', JSON.stringify(config, null, 2));

      return new Response(JSON.stringify({ code: 10200, info: '更新成功' }), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    if (action === 'updatePassword') {
      const body = await request.json().catch(() => ({}));
      const { oldPassword, newPassword } = body;

      if (!oldPassword || !newPassword) {
        return new Response(JSON.stringify({ code: 10400, info: '缺少参数' }), {
          status: 400,
          headers: CORS_HEADERS
        });
      }

      if (newPassword.length < 4) {
        return new Response(JSON.stringify({ code: 10401, info: '新密码长度不足' }), {
          status: 400,
          headers: CORS_HEADERS
        });
      }

      const inputHash = await sha256(config.passSalt + oldPassword + config.passSalt);

      if (inputHash !== config.passHash) {
        return new Response(JSON.stringify({ code: 10203, info: '原密码错误' }), {
          status: 200,
          headers: CORS_HEADERS
        });
      }

      const newSalt = await generateSalt();
      config.passSalt = newSalt;
      config.passHash = await sha256(newSalt + newPassword + newSalt);

      await store.put('config.json', JSON.stringify(config, null, 2));

      return new Response(JSON.stringify({ code: 10200, info: '密码更新成功' }), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    if (action === 'init') {
      const body = await request.json().catch(() => ({}));
      const { password } = body;

      if (!password || password.length < 4) {
        return new Response(JSON.stringify({ code: 10401, info: '密码长度不足' }), {
          status: 400,
          headers: CORS_HEADERS
        });
      }

      const salt = await generateSalt();
      const hash = await sha256(salt + password + salt);

      config.passSalt = salt;
      config.passHash = hash;
      config.initialized = true;
      config.uid = generateUID();
      config.version = '1.0.0';

      await store.put('config.json', JSON.stringify(config, null, 2));

      return new Response(JSON.stringify({ code: 10200, info: '初始化成功' }), {
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