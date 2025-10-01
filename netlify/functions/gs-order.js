// netlify/functions/gs-order.js
exports.handler = async (event) => {
  const target = process.env.GS_WEBAPP_URL; // URL /exec del último deployment de tu GAS
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
    let url = target;
    let fetchOpts = {};

    if (event.httpMethod === 'GET') {
      const qs = event.rawQuery || '';
      url = qs ? `${target}?${qs}` : target;
      fetchOpts = { method: 'GET' };
    } else if (event.httpMethod === 'POST') {
      // reenviamos form-urlencoded tal cual
      fetchOpts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: event.body
      };
    } else {
      return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
    }

    const res = await fetch(url, fetchOpts);
    const text = await res.text();
    // devolvemos como JSON si es parseable
    let body = text, ct = 'application/json';
    try { body = JSON.stringify(JSON.parse(text)); } catch { ct = 'text/plain'; }

    return { statusCode: res.status, headers: { ...cors, 'Content-Type': ct }, body };

  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error: String(err) }) };
  }
};
