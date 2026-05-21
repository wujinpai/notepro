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
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'get';

    if (action === 'get') {
      if (!isLogin) {
        return UNAUTHORIZED_RESPONSE();
      }

      return SUCCESS_RESPONSE({
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
      });
    }

    if (!isLogin) {
      return UNAUTHORIZED_RESPONSE();
    }

    if (action === 'update') {
      const body = await request.json().catch(() => ({}));
      const { key, value } = body;

      if (!key) {
        return ERROR_RESPONSE(10400, '缺少参数');
      }

      const sensitiveKeys = ['locationApiKey', 'weatherApiKey', 'passHash', 'passSalt'];
      if (sensitiveKeys.includes(key)) {
        config[key] = value;
      } else {
        config[key] = value;
      }

      config.cache = Date.now();

      await store.put('config.json', JSON.stringify(config, null, 2));

      return SUCCESS_RESPONSE({}, '更新成功');
    }

    if (action === 'updatePassword') {
      const body = await request.json().catch(() => ({}));
      const { oldPassword, newPassword } = body;

      if (!oldPassword || !newPassword) {
        return ERROR_RESPONSE(10400, '缺少参数');
      }

      if (newPassword.length < 4) {
        return ERROR_RESPONSE(10401, '新密码长度不足');
      }

      const inputHash = await sha256(config.passSalt + oldPassword + config.passSalt);

      if (inputHash !== config.passHash) {
        return ERROR_RESPONSE(10203, '原密码错误');
      }

      const newSalt = await generateSalt();
      config.passSalt = newSalt;
      config.passHash = await sha256(newSalt + newPassword + newSalt);

      await store.put('config.json', JSON.stringify(config, null, 2));

      return SUCCESS_RESPONSE({}, '密码更新成功');
    }

    if (action === 'init') {
      const body = await request.json().catch(() => ({}));
      const { password } = body;

      if (!password || password.length < 4) {
        return ERROR_RESPONSE(10401, '密码长度不足');
      }

      const salt = await generateSalt();
      const hash = await sha256(salt + password + salt);

      config.passSalt = salt;
      config.passHash = hash;
      config.initialized = true;
      config.uid = generateUID();
      config.version = '1.0.0';

      await store.put('config.json', JSON.stringify(config, null, 2));

      return SUCCESS_RESPONSE({}, '初始化成功');
    }

    return ERROR_RESPONSE(10400, '未知操作');
  } catch (error) {
    return ERROR_RESPONSE(10500, '请求失败: ' + error.message);
  }
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