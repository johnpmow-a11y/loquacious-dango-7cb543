import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(ROOT, 'public');
const FUNCTIONS_DIR = path.resolve(ROOT, 'netlify', 'functions');
const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const functionCache = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...headers
  });
  res.end(body ?? '');
}

function queryObject(searchParams) {
  const result = {};
  for (const [key, value] of searchParams) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
    } else result[key] = value;
  }
  return result;
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function invokeFunction(req, res, url, name) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return send(res, 404, 'Function not found.');
  let module = functionCache.get(name);
  if (!module) {
    let file;
    for (const extension of ['.mjs', '.js']) {
      const candidate = path.join(FUNCTIONS_DIR, name + extension);
      try { await fs.access(candidate); file = candidate; break; } catch {}
    }
    if (!file) return send(res, 404, JSON.stringify({ error: 'Function not found.' }), { 'Content-Type': 'application/json; charset=utf-8' });
    module = await import(pathToFileURL(file).href);
    functionCache.set(name, module);
  }

  const handler = module.handler || module.default?.handler || module.default;
  if (typeof handler !== 'function') {
    return send(res, 500, JSON.stringify({ error: 'Function handler is not exported.' }), { 'Content-Type': 'application/json; charset=utf-8' });
  }

  const rawBody = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readRequestBody(req);
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  const isBinary = contentType.startsWith('multipart/form-data') || contentType.startsWith('image/') || contentType.startsWith('video/') || contentType.startsWith('audio/') || contentType.includes('application/octet-stream');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const event = {
    httpMethod: req.method,
    headers: { ...req.headers },
    multiValueHeaders: {},
    queryStringParameters: queryObject(url.searchParams),
    multiValueQueryStringParameters: {},
    path: url.pathname,
    rawUrl: forwardedProto + '://' + (req.headers.host || 'localhost') + req.url,
    rawQuery: url.search.startsWith('?') ? url.search.slice(1) : '',
    body: isBinary ? rawBody.toString('base64') : rawBody.toString('utf8'),
    isBase64Encoded: isBinary
  };

  const result = await handler(event, {});
  const statusCode = Number(result?.statusCode || 200);
  const responseHeaders = { ...(result?.headers || {}) };
  if (!responseHeaders['Content-Type'] && !responseHeaders['content-type']) {
    responseHeaders['Content-Type'] = 'application/json; charset=utf-8';
  }
  let body = result?.body ?? '';
  if (result?.isBase64Encoded && typeof body === 'string') body = Buffer.from(body, 'base64');
  else if (typeof body !== 'string' && !Buffer.isBuffer(body)) body = JSON.stringify(body);
  send(res, statusCode, req.method === 'HEAD' || statusCode === 204 ? '' : body, responseHeaders);
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return send(res, 400, 'Invalid URL path.'); }
  if (pathname === '/terms') pathname = '/terms.html';
  if (pathname === '/privacy') pathname = '/privacy.html';
  if (pathname === '/') pathname = '/index.html';

  const file = path.resolve(PUBLIC_DIR, '.' + pathname);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden.');
  let stat;
  try {
    stat = await fs.stat(file);
    if (stat.isDirectory()) {
      pathname = path.posix.join(pathname, 'index.html');
      stat = await fs.stat(path.join(file, 'index.html'));
    }
  } catch { return send(res, 404, 'Not found.'); }
  if (!stat.isFile()) return send(res, 404, 'Not found.');

  const extension = path.extname(file).toLowerCase();
  const headers = {
    'Content-Type': MIME[extension] || 'application/octet-stream',
    'Content-Length': String(stat.size),
    'Cache-Control': extension === '.html' || path.basename(file) === 'sw.js' ? 'no-cache' : 'public, max-age=3600'
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file);
  stream.on('error', () => { if (!res.headersSent) send(res, 500, 'Could not read file.'); else res.destroy(); });
  stream.pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    if (url.pathname === '/_healthz') {
      return send(res, 200, JSON.stringify({ ok: true, service: 'all-ads-manager' }), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    const functionPrefix = '/.netlify/functions/';
    if (url.pathname.startsWith(functionPrefix)) {
      let functionName = url.pathname.slice(functionPrefix.length);
      if (functionName.endsWith('/')) functionName = functionName.slice(0, -1);
      return await invokeFunction(req, res, url, functionName);
    }
    return await serveStatic(req, res, url);
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    console.error('All Ads Manager request failed:', error?.message || 'Unknown error');
    if (!res.headersSent) send(res, status, JSON.stringify({ error: status >= 500 ? 'The service is temporarily unavailable.' : error.message }), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    else res.destroy();
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('All Ads Manager Fly server listening on port ' + PORT);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
