// 系统初始化 API - 使用内存存储（临时方案）

let CONFIG_DATA = null;

function generateSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => 
    b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const msgBuffer = new TextEncoder().encode(salt + password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer), b => 
    b.toString(16).padStart(2, '0')).join('');
}

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
      
      if (CONFIG_DATA) {
        return new Response(JSON.stringify({
          code: 10200,
          info: '已初始化',
          initialized: true
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      
      const salt = generateSalt();
      const passHash = await hashPassword(password, salt);
      
      CONFIG_DATA = {
        siteTitle: '格物',
        userName: '浮生若梦',
        userSign: '我为良世当浮尘，天地自为我提灯…',
        passHash: passHash,
        passSalt: salt,
        sessions: {},
        initialized: true,
      };
      
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
      info: CONFIG_DATA ? '已初始化' : '未初始化',
      initialized: !!CONFIG_DATA
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      code: 10500,
      info: '请求失败: ' + (error?.message || String(error))
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}