// 系统初始化 API
import { getStore } from "@edgeone/pages-blob";

export default async function onRequest(context) {
  const { request } = context;
  
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  
  try {
    const store = getStore("notepro");
    const configData = await store.get("config.json");
    
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const password = body?.password;
      
      if (!password || password.length < 4) {
        return new Response(JSON.stringify({
          code: 10401,
          info: '密码长度不足或为空'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      
      if (configData) {
        return new Response(JSON.stringify({
          code: 10200,
          info: '已初始化',
          initialized: true
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      
      // 生成密码哈希
      const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      const msgBuffer = new TextEncoder().encode(salt + password + salt);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const passHash = Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
      
      const defaultConfig = {
        siteTitle: '格物',
        userName: '浮生若梦',
        userSign: '我为良世当浮尘，天地自为我提灯…',
        mainColor: '#39393a',
        backgroundColor: '#f7f7f7',
        cardColor: '#ffffff',
        postCount: 10,
        defaultTag: '随记',
        visitMode: 0,
        loginTimeout: 3600,
        passHash: passHash,
        passSalt: salt,
        sessions: {},
        initialized: true,
      };
      
      // 初始化数据
      await store.set('config.json', JSON.stringify(defaultConfig, null, 2));
      await store.set('posts.json', '[]');
      await store.set('tags.json', '[]');
      await store.set('calendar.json', '{}');
      
      return new Response(JSON.stringify({
        code: 10200,
        info: '初始化成功',
        initialized: false
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
    
    return new Response(JSON.stringify({
      code: 10200,
      info: configData ? '已初始化' : '未初始化',
      initialized: !!configData
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (error) {
    console.error('Init error:', error);
    return new Response(JSON.stringify({
      code: 10500,
      info: '请求失败: ' + (error?.message || String(error))
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}