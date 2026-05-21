export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

export const SUCCESS_RESPONSE = (data = {}, message = 'success') => {
  return new Response(JSON.stringify({
    code: 10200,
    info: message,
    ...data
  }), {
    status: 200,
    headers: CORS_HEADERS
  });
};

export const ERROR_RESPONSE = (code, message) => {
  return new Response(JSON.stringify({ code, info: message }), {
    status: code >= 10400 ? code : 200,
    headers: CORS_HEADERS
  });
};

export const UNAUTHORIZED_RESPONSE = () => {
  return new Response(JSON.stringify({ code: 10401, info: '未经授权' }), {
    status: 401,
    headers: CORS_HEADERS
  });
};

export async function getJsonBody(request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await request.json();
    }
    const formData = await request.formData();
    const body = {};
    for (const [key, value] of formData.entries()) {
      body[key] = value;
    }
    return body;
  } catch (error) {
    return {};
  }
}

export async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateToken() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

export function parseJsonSafe(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}