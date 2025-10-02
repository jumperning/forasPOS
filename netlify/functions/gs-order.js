// netlify/functions/gs-order.js
export async function handler(event) {
  const target = process.env.GS_WEBAPP_URL; // URL /exec de tu GAS
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  if (!target) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error:'GS_WEBAPP_URL no configurada' }) };
  }

  try {
    const method = event.httpMethod || 'GET';
    const url = method === 'GET'
      ? (event.rawQuery ? `${target}?${event.rawQuery}` : target)
      : target;

    const fetchOpts = {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: method === 'POST' ? event.body : undefined,
      redirect: 'follow'
    };

    const resp = await fetch(url, fetchOpts);
    const text = await resp.text();
    const ct = resp.headers.get('content-type') || 'application/json';

    return {
      statusCode: resp.status,
      headers: { ...cors, 'Content-Type': ct },
      body: text
    };

  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error:String(err) }) };
  }
}
