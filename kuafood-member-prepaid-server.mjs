import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'kuafood-member-prepaid-query.html');
const port = Number(process.env.PORT || 8766);
const HOST_B = process.env.KUAFOD_HOST_B || 'https://b.kuafood.com';
let importedAuth = null;

const targets = {
  customerList: {
    method: 'GET',
    url: `${HOST_B}/api/b/customer/lists`,
  },
  customerDetail: {
    method: 'GET',
    url: `${HOST_B}/api/b/customer`,
    pathParam: 'customerId',
  },
  prePaidLogs: {
    method: 'GET',
    url: `${HOST_B}/api/b/customer`,
    pathParam: 'customerId',
    subPath: 'prePaidLogs',
  },
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function buildHeaders(inputHeaders = {}) {
  const headers = {
    accept: 'application/json, text/plain, */*',
    appid: String(inputHeaders.appid || '').trim(),
    brandid: String(inputHeaders.brandid || '1').trim(),
    shopid: String(inputHeaders.shopid || '0').trim(),
    origin: 'https://b.kuafood.com',
    referer: 'https://b.kuafood.com/',
    'user-agent':
      inputHeaders.userAgent ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  };

  const authorization = String(inputHeaders.authorization || '').trim();
  if (authorization) {
    headers.authorization = authorization.startsWith('Bearer ')
      ? authorization
      : `Bearer ${authorization}`;
  }

  const cookie = String(inputHeaders.cookie || '').trim();
  if (cookie) headers.cookie = cookie;

  return headers;
}

async function proxyKuafood(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, message: '请求 JSON 解析失败' });
    return;
  }

  const target = targets[payload.target];
  if (!target) {
    sendJson(res, 400, { ok: false, message: '未知接口目标' });
    return;
  }

  const headers = buildHeaders(payload.headers);
  if (!headers.appid || !headers.authorization) {
    sendJson(res, 400, { ok: false, message: '缺少 appid 或 authorization' });
    return;
  }

  const url = new URL(target.url);
  const fetchOptions = { method: target.method, headers };

  if (target.pathParam) {
    const value = String(payload.path?.[target.pathParam] || '').trim();
    if (!/^\d+$/.test(value)) {
      sendJson(res, 400, { ok: false, message: `${target.pathParam} 格式不正确` });
      return;
    }
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${value}`;
    if (target.subPath) {
      url.pathname = `${url.pathname}/${target.subPath}`;
    }
  }

  if (target.method === 'GET') {
    for (const [key, value] of Object.entries(payload.query || {})) {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  } else {
    headers['content-type'] = 'application/json';
    fetchOptions.body = JSON.stringify(payload.body || {});
  }

  const attempts = 3;
  let upstream;
  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        upstream = await fetch(url, { ...fetchOptions, signal: controller.signal });
        clearTimeout(timer);
      } catch (fetchError) {
        clearTimeout(timer);
        if (attempt < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
          continue;
        }
        throw fetchError;
      }
      if (upstream.status >= 500 && attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        continue;
      }
      break;
    }

    const text = await upstream.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      // raw text for diagnostics
    }

    sendJson(res, upstream.status, {
      ok: upstream.ok,
      status: upstream.status,
      target: payload.target,
      data,
    });
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function sanitizeAuthPayload(body) {
  const token = String(body.token || body.authorization || '').trim();
  const cookie = String(body.cookie || '').trim();
  const sourceUrl = String(body.sourceUrl || '').trim();
  const tokenSource = String(body.tokenSource || '').trim();

  if (!sourceUrl.startsWith('https://b.kuafood.com/')) {
    throw new Error('授权导入只接受 b.kuafood.com 页面来源。');
  }
  if (!token && !cookie) {
    throw new Error('没有读取到 token 或 cookie。');
  }

  return {
    token,
    cookie,
    sourceUrl,
    tokenSource,
    importedAt: new Date().toISOString(),
  };
}

async function handleImportAuth(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    importedAuth = sanitizeAuthPayload(body);
    sendJson(res, 200, {
      ok: true,
      importedAt: importedAuth.importedAt,
      hasToken: Boolean(importedAuth.token),
      hasCookie: Boolean(importedAuth.cookie),
      tokenSource: importedAuth.tokenSource,
      sourceUrl: importedAuth.sourceUrl,
    });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function handleAuthState(res) {
  if (!importedAuth) {
    sendJson(res, 200, { hasAuth: false });
    return;
  }
  sendJson(res, 200, {
    hasAuth: true,
    token: importedAuth.token,
    cookie: importedAuth.cookie,
    importedAt: importedAuth.importedAt,
    tokenSource: importedAuth.tokenSource,
    sourceUrl: importedAuth.sourceUrl,
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/auth-state') {
    handleAuthState(res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/import-auth') {
    await handleImportAuth(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/kuafood') {
    await proxyKuafood(req, res);
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && (req.url === '/' || req.url === '/kuafood-member-prepaid-query.html')) {
    const html = await readFile(htmlPath);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': html.length,
      'cache-control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : html);
    return;
  }

  sendJson(res, 404, { ok: false, message: 'Not found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Kuafood member prepaid query: http://127.0.0.1:${port}/`);
});
