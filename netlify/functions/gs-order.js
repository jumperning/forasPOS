// /.netlify/functions/gs-order
export async function handler(event) {
  // Permitir CORS del frontend (mismo dominio en Netlify)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const target = process.env.GS_WEBAPP_URL; // poné acá tu URL /exec de Apps Script

    // el front nos manda form-urlencoded (action=saveOrder&data=...)
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: event.body
    });

    // Apps Script a veces devuelve texto plano; lo reenviamos tal cual,
    // intentando parsear JSON si corresponde
    const text = await res.text();
    let body = text;
    try { body = JSON.stringify(JSON.parse(text)); } catch (_) {}

    return {
      statusCode: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok:false, error: String(err) })
    };
  }
}
