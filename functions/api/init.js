import { CORS_HEADERS } from '../_shared.js';

function getStore(bucketName = 'notepro') {
  return __STATIC_CONTENT.bucket(bucketName);
}

export async function onRequest(context) {
  const request = context.request;

  const responseHeaders = {
    ...CORS_HEADERS,
    'Content-Type': 'application/json'
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  try {
    const store = getStore();
    const configData = await store.get('config.json').catch(() => null);

    if (request.method === 'POST') {
      const body = await request.json().catch(() => {});
      const password = body?.password;

      if (!password || password.length < 4) {
        return new Response(JSON.stringify({ code: 10401, info: '密码长度不足或为空' }), {
          status: 400,
          headers: responseHeaders
        });
      }

      if (configData) {
        return new Response(JSON.stringify({ code: 10200, info: '已初始化', initialized: true }), {
          status: 200,
          headers: responseHeaders
        });
      }

      const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      const msgBuffer = new TextEncoder().encode(salt + password + salt);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const passHash = Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');

      const defaultConfig = {
        siteTitle: '格物',
        siteDescription: 'Personal notes and blog',
        siteKeywords: '',
        siteTimeZone: 'Asia/Shanghai',
        siteLang: 'zh_CN',
        siteCharset: 'UTF-8',
        siteZoom: 0,
        userName: '浮生若梦',
        userSign: '我为良世当浮尘，天地自为我提灯…',
        userEmail: '',
        mainColor: '#39393a',
        backgroundColor: '#f7f7f7',
        cardColor: '#ffffff',
        card2Color: '#9891cd',
        titleColor: '#39393a',
        contentColor: '#39393a',
        descColor: '#7a7a7a',
        toolColor: '#f1f1f1',
        buttonColor: '#29adff',
        inputColor: '#707070',
        tagColor: '#53c3e9',
        postCount: 10,
        postHiddenTip: 0,
        viewRange: 0,
        defaultTag: '随记',
        visitMode: 0,
        backTop: 1,
        pictureZip: 0,
        pictureEncryption: 0,
        calendarSearch: 'only',
        siteVisibility: 'public',
        pictureZipHigh: 0,
        locationShowMode: 12,
        defaultLocation: '',
        socialMedia: {},
        siteMap: [],
        copyright: '',
        cors: 0,
        uid: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        }),
        version: '1.0.0',
        cache: Date.now(),
        loginTimeout: 3600,
        pseudoStatic: 1,
        displayTip: 1,
        initialized: true,
        passHash: passHash,
        passSalt: salt,
        sessions: {}
      };

      await store.put('config.json', JSON.stringify(defaultConfig, null, 2));
      await store.put('posts.json', '[]');
      await store.put('tags.json', '[]');
      await store.put('calendar.json', '{}');

      return new Response(JSON.stringify({ code: 10200, info: '初始化成功', initialized: false }), {
        status: 200,
        headers: responseHeaders
      });
    }

    return new Response(JSON.stringify({ 
      code: 10200, 
      info: configData ? '已初始化' : '未初始化',
      initialized: !!configData 
    }), {
      status: 200,
      headers: responseHeaders
    });

  } catch (error) {
    return new Response(JSON.stringify({ code: 10500, info: '请求失败: ' + error.message }), {
      status: 500,
      headers: responseHeaders
    });
  }
}