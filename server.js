'use strict';
/**
 * 拍摄策划 · Shoot Plan
 * 轻量本地服务：静态站点 + OpenAI 兼容模型代理 + 图片检索/代理（解决跨域与防盗链）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CACHE_DIR = path.join(ROOT, '.cache');
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) { /* ignore */ }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 带水印的商业图库站，检索时直接跳过
const STOCK_BLOCK = /(shutterstock|dreamstime|istockphoto|gettyimages|alamy|freepik|pngtree|123rf|depositphotos|vecteezy|zcool|hellorf|stock\.adobe|canstock|bigstock|pond5|envato|pikbest|photodune|depositphotos|watermark)/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/* ------------------------------------------------------------------ utils */

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}

function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function htmlDecode(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#0?34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function cleanText(s, max = 160) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, max);
}

async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ac.signal }));
  } finally {
    clearTimeout(timer);
  }
}

function isPrivateHost(hostname) {
  if (!hostname) return true;
  const h = String(hostname).replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^(fc|fd|fe80)/.test(h)) return true;
  return false;
}

function isLocalRequest(req) {
  const h = String(req.headers.host || '').split(':')[0].replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
}

function mayUsePrivate(req) {
  return isLocalRequest(req) || process.env.ALLOW_PRIVATE_TARGETS === '1';
}

/* --------------------------------------------------------- LLM proxy */

async function handleLLM(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'));
  } catch (e) {
    return sendJSON(res, 400, { error: '请求体不是合法 JSON' });
  }
  const { baseUrl, apiKey, body } = payload || {};
  if (!baseUrl || !body) return sendJSON(res, 400, { error: '缺少 baseUrl 或 body' });

  let target;
  try {
    target = new URL(String(baseUrl).trim());
  } catch (e) {
    return sendJSON(res, 400, { error: '接口地址不合法，请填写形如 https://api.deepseek.com/v1 的地址' });
  }
  if (!/^https?:$/.test(target.protocol)) return sendJSON(res, 400, { error: '仅支持 http/https 接口' });
  if (isPrivateHost(target.hostname) && !mayUsePrivate(req)) {
    return sendJSON(res, 403, { error: '公网部署下不允许访问内网地址' });
  }

  let endpoint = target.href.replace(/\/+$/, '');
  if (!/\/chat\/completions$/.test(endpoint)) endpoint += '/chat/completions';

  let upstream;
  try {
    upstream = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey || ''}`,
        },
        body: JSON.stringify(body),
      },
      180000
    );
  } catch (e) {
    const why = e && e.name === 'AbortError' ? '请求超时（180s）' : (e && e.message) || '网络错误';
    return sendJSON(res, 502, { error: '连接模型接口失败：' + why });
  }

  const text = await upstream.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not json */ }

  if (!upstream.ok) {
    let msg = text.slice(0, 400);
    if (data && data.error) msg = data.error.message || data.error.code || msg;
    else if (data && data.message) msg = data.message;
    return sendJSON(res, 502, { error: `模型接口返回 ${upstream.status}：${cleanText(msg, 400)}` });
  }
  if (!data) return sendJSON(res, 502, { error: '模型接口返回了非 JSON 内容' });
  sendJSON(res, 200, data);
}

/* ------------------------------------------------------- image search */

const searchCache = new Map();
const SEARCH_TTL = 10 * 60 * 1000;

async function searchBing(q, n) {
  const count = Math.min(35, Math.max(n + 12, 24));
  const u = `https://www.bing.com/images/async?q=${encodeURIComponent(q)}&first=1&count=${count}&mmasync=1&mkt=zh-CN&adlt=moderate`;
  const r = await fetchWithTimeout(
    u,
    {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
        Referer: 'https://www.bing.com/images/search?q=' + encodeURIComponent(q),
      },
    },
    18000
  );
  if (!r.ok) throw new Error('Bing HTTP ' + r.status);
  const html = await r.text();
  const out = [];
  const seen = new Set();
  const re = /m="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    let o;
    try { o = JSON.parse(htmlDecode(m[1])); } catch (e) { continue; }
    const full = o && o.murl;
    if (!full || !/^https?:\/\//i.test(full)) continue;
    if (/\.(gif|svg|ico)(\?|#|$)/i.test(full)) continue;
    if (/(logo|icon|sprite|avatar|emoji)/i.test(full)) continue;
    if (STOCK_BLOCK.test(full)) continue;
    const key = full.split('?')[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      url: full,
      thumb: o.turl && /^https?:\/\//i.test(o.turl) ? o.turl : '',
      title: cleanText(o.t || ''),
      source: 'bing',
      page: o.purl || '',
    });
    if (out.length >= n) break;
  }
  return out;
}

async function searchUnsplash(q, n) {
  const u = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(q)}&per_page=${Math.min(30, n)}&page=1`;
  const r = await fetchWithTimeout(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, 15000);
  if (!r.ok) throw new Error('Unsplash HTTP ' + r.status);
  const j = await r.json();
  return (j.results || []).map((p) => ({
    url: p.urls && (p.urls.regular || p.urls.full),
    thumb: p.urls && (p.urls.small || p.urls.thumb),
    title: cleanText(p.alt_description || p.description || ''),
    source: 'unsplash',
    page: p.links && p.links.html,
  })).filter((x) => x.url).slice(0, n);
}

async function searchOpenverse(q, n) {
  const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${Math.min(20, n)}`;
  const r = await fetchWithTimeout(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, 12000);
  if (!r.ok) throw new Error('Openverse HTTP ' + r.status);
  const j = await r.json();
  return (j.results || []).map((p) => ({
    url: p.url,
    thumb: p.thumbnail || '',
    title: cleanText(p.title || ''),
    source: 'openverse',
    page: p.foreign_landing_url || '',
  })).filter((x) => x.url).slice(0, n);
}

async function searchCustom(q, n, tpl) {
  if (!tpl) throw new Error('未配置自定义图源地址');
  const u = tpl.replace(/\{q\}/g, encodeURIComponent(q)).replace(/\{n\}/g, String(n));
  let target;
  try { target = new URL(u); } catch (e) { throw new Error('自定义图源地址不合法'); }
  if (isPrivateHost(target.hostname)) throw new Error('自定义图源不支持内网地址');
  const r = await fetchWithTimeout(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, 15000);
  if (!r.ok) throw new Error('自定义图源 HTTP ' + r.status);
  const j = await r.json();
  const arr = Array.isArray(j) ? j
    : (j.results || j.items || j.hits || j.data || (j.data && j.data.results) || []);
  return arr.map((x) => {
    const src = x.src && typeof x.src === 'object' ? x.src : {};
    return {
      url: x.url || x.image || x.imageUrl || x.image_url || src.original || src.large || src.large2x || x.link,
      thumb: x.thumbnail || x.thumb || x.preview || src.medium || src.small || '',
      title: cleanText(x.title || x.description || x.alt || ''),
      source: 'custom',
      page: x.page || x.link || '',
    };
  }).filter((x) => x && /^https?:\/\//.test(x.url || '')).slice(0, n);
}

async function runSearch(provider, q, n, tpl) {
  if (provider === 'bing') return searchBing(q, n);
  if (provider === 'unsplash') return searchUnsplash(q, n);
  if (provider === 'openverse') return searchOpenverse(q, n);
  if (provider === 'custom') return searchCustom(q, n, tpl);
  throw new Error('未知图源 ' + provider);
}

async function handleImages(req, res, url) {
  const q = (url.searchParams.get('q') || '').trim();
  const n = Math.max(1, Math.min(30, Number(url.searchParams.get('n') || 12)));
  const provider = url.searchParams.get('provider') || 'auto';
  const tpl = url.searchParams.get('tpl') || '';
  if (!q) return sendJSON(res, 400, { error: '缺少检索词 q' });

  const key = `${provider}|${n}|${q}|${tpl}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.t < SEARCH_TTL) return sendJSON(res, 200, hit.v);

  const order = provider === 'auto' ? ['bing', 'unsplash', 'openverse'] : [provider];
  const errors = [];
  let best = null;

  for (const p of order) {
    try {
      const items = await runSearch(p, q, n, tpl);
      if (!items || !items.length) { errors.push(`${p}: 无结果`); continue; }
      if (!best || items.length > best.items.length) best = { items, provider: p };
      if (items.length >= Math.min(4, n)) break;
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }

  const out = best
    ? { q, provider: best.provider, items: best.items, errors }
    : { q, provider: 'none', items: [], errors };
  if (best) searchCache.set(key, { t: Date.now(), v: out });
  sendJSON(res, 200, out);
}

/* ------------------------------------------------------ 小红书笔记解析 */

const xhsCache = new Map();

async function handleXhsNote(req, res, url) {
  const raw = (url.searchParams.get('url') || '').trim();
  if (!raw) return sendJSON(res, 400, { error: '缺少笔记链接' });
  let target;
  try { target = new URL(raw); } catch (e) { return sendJSON(res, 400, { error: '链接格式不对' }); }
  const host = target.hostname.replace(/^www\./, '');
  if (host !== 'xiaohongshu.com' && host !== 'xhslink.com') {
    return sendJSON(res, 400, { error: '只支持小红书笔记链接（xiaohongshu.com / xhslink.com）' });
  }
  if (!/^https?:$/.test(target.protocol)) return sendJSON(res, 400, { error: '链接格式不对' });
  if (host === 'xiaohongshu.com' && !/^\/(explore|discovery\/item)\/[0-9a-zA-Z]+/.test(target.pathname)) {
    return sendJSON(res, 400, { error: '这不是单篇笔记的链接。请打开具体笔记再复制地址（形如 /explore/24位ID）。' });
  }

  // 图片链接带时效签名，只做很短时间的缓存，避免拿到过期地址
  const hit = xhsCache.get(target.href);
  if (hit && Date.now() - hit.t < 60 * 1000) return sendJSON(res, 200, hit.v);

  let r;
  try {
    r = await fetchWithTimeout(target.href, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Referer: 'https://www.xiaohongshu.com/',
      },
      redirect: 'follow',
    }, 20000);
  } catch (e) {
    return sendJSON(res, 502, { error: '抓取失败：' + (e.name === 'AbortError' ? '超时' : e.message) });
  }
  if (!r.ok) return sendJSON(res, 502, { error: '抓取失败：HTTP ' + r.status });

  const html = await r.text();
  const finalUrl = r.url || target.href;
  const titleRaw = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const title = htmlDecode(titleRaw).replace(/\s*[-|—]\s*小红书\s*$/, '').trim();

  const images = [];
  const seen = new Set();
  const re = /https?:\/\/sns-[a-z0-9-]+\.xhscdn\.com\/[^"'\\\s)]+/g;
  let m;
  while ((m = re.exec(html))) {
    const u = htmlDecode(m[0]);
    if (!/notes_pre_post|\/spectrum\//.test(u)) continue;
    const base = u.split('!')[0];
    if (seen.has(base)) continue;
    seen.add(base);
    images.push({ url: u, thumb: u });
    if (images.length >= 12) break;
  }

  let error = '';
  if (!images.length) {
    if (/\/website-login|\/login(\?|$)/.test(finalUrl)) {
      error = '这篇笔记需要登录才能查看，换一篇公开笔记试试。';
    } else if (/\/404(\?|\/|$)/.test(finalUrl) || /error_code=3000(17|31)/.test(finalUrl) || html.indexOf('你访问的页面不见了') !== -1) {
      error = '笔记打不开：链接可能不完整、已删除或设为私密，也可能缺少分享参数（xsec_token）。请在 App 里用「分享 → 复制链接」重新复制一次。';
    } else {
      error = '没有解析到配图：这篇笔记可能只有文字，或图片需要登录后查看。';
    }
  }

  const out = images.length
    ? { ok: true, title: title || '小红书笔记', noteUrl: finalUrl, images }
    : { ok: false, error, noteUrl: finalUrl, images: [] };

  if (images.length) xhsCache.set(target.href, { t: Date.now(), v: out });
  sendJSON(res, 200, out);
}

/* ------------------------------------------------------ image proxy */

let cacheWrites = 0;

function sniffImage(b) {
  if (!b || b.length < 12) return '';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.slice(0, 2).toString() === 'BM') return 'image/bmp';
  return '';
}

async function handleImage(req, res, url) {
  const raw = url.searchParams.get('u');
  if (!raw) return sendText(res, 400, 'missing u');
  let target;
  try { target = new URL(raw); } catch (e) { return sendText(res, 400, 'bad url'); }
  if (!/^https?:$/.test(target.protocol)) return sendText(res, 400, 'bad protocol');
  if (isPrivateHost(target.hostname) && !mayUsePrivate(req)) return sendText(res, 403, 'blocked');

  const hash = crypto.createHash('sha1').update(target.href).digest('hex');
  const file = path.join(CACHE_DIR, 'img-' + hash);
  const typeFile = file + '.type';

  let buf = null;
  let ctype = 'image/jpeg';
  try {
    buf = fs.readFileSync(file);
    ctype = fs.readFileSync(typeFile, 'utf8');
  } catch (e) { buf = null; }

  if (!buf) {
    let upstream;
    try {
      upstream = await fetchWithTimeout(
        target.href,
        {
          headers: {
            'User-Agent': UA,
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            Referer: /(^|\.)xhscdn\.com$/i.test(target.hostname)
              ? 'https://www.xiaohongshu.com/'
              : target.origin + '/',
          },
          redirect: 'follow',
        },
        20000
      );
    } catch (e) {
      return sendText(res, 504, 'upstream timeout');
    }
    if (!upstream.ok) return sendText(res, 502, 'upstream ' + upstream.status);
    const ct = (upstream.headers.get('content-type') || '').split(';')[0].trim();
    const ab = await upstream.arrayBuffer();
    buf = Buffer.from(ab);
    const sniffed = sniffImage(buf);
    if (!/^image\//i.test(ct) && !sniffed) return sendText(res, 415, 'not an image: ' + ct);
    if (buf.length > 18 * 1024 * 1024) return sendText(res, 413, 'too large');
    ctype = /^image\//i.test(ct) ? ct : sniffed;
    if (buf.length < 6 * 1024 * 1024) {
      try {
        fs.writeFileSync(file, buf);
        fs.writeFileSync(typeFile, ctype);
        if (++cacheWrites % 80 === 0) pruneCache();
      } catch (e) { /* ignore */ }
    }
  }

  res.writeHead(200, {
    'Content-Type': ctype,
    'Content-Length': buf.length,
    'Cache-Control': 'public, max-age=604800, immutable',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(buf);
}

function pruneCache() {
  const LIMIT = 450 * 1024 * 1024;
  fs.readdir(CACHE_DIR, (err, files) => {
    if (err) return;
    let total = 0;
    const stat = [];
    for (const f of files) {
      try {
        const s = fs.statSync(path.join(CACHE_DIR, f));
        total += s.size;
        stat.push({ f, m: s.mtimeMs, s: s.size });
      } catch (e) { /* ignore */ }
    }
    if (total < LIMIT) return;
    stat.sort((a, b) => a.m - b.m);
    let freed = 0;
    for (const it of stat) {
      if (total - freed < LIMIT * 0.7) break;
      try { fs.unlinkSync(path.join(CACHE_DIR, it.f)); freed += it.s; } catch (e) { /* ignore */ }
    }
  });
}

/* ------------------------------------------------------------ static */

function serveStatic(req, res, url) {
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { p = '/'; }
  if (p === '/' || p === '') p = '/index.html';
  const rel = path.normalize(p).replace(/^([/\\]|\.\.[/\\])+/, '');
  const fp = path.join(PUBLIC_DIR, rel);
  if (!fp.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'forbidden');

  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) {
      if (!path.extname(p)) return serveIndex(res);
      return sendText(res, 404, 'not found');
    }
    const ext = path.extname(fp).toLowerCase();
    const noCache = ext === '.html' || ext === '.css' || ext === '.js' || ext === '.json';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=1800',
    });
    fs.createReadStream(fp).pipe(res);
  });
}

function serveIndex(res) {
  const fp = path.join(PUBLIC_DIR, 'index.html');
  fs.readFile(fp, (err, buf) => {
    if (err) return sendText(res, 500, 'index.html missing');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

/* ------------------------------------------------------------ server */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        });
        return res.end();
      }
      if (url.pathname === '/api/health') {
        return sendJSON(res, 200, { ok: true, node: process.version, time: Date.now() });
      }
      if (url.pathname === '/api/llm' && req.method === 'POST') return await handleLLM(req, res);
      if (url.pathname === '/api/images') return await handleImages(req, res, url);
      if (url.pathname === '/api/xhs/note') return await handleXhsNote(req, res, url);
      if (url.pathname === '/api/img') return await handleImage(req, res, url);
      return sendJSON(res, 404, { error: 'unknown api' });
    }
    return serveStatic(req, res, url);
  } catch (err) {
    console.error('[error]', url.pathname, err && err.message);
    if (!res.headersSent) sendJSON(res, 500, { error: (err && err.message) || 'server error' });
    else try { res.end(); } catch (e) { /* ignore */ }
  }
});

server.listen(PORT, () => {
  console.log(`拍摄策划 · Shoot Plan  →  http://localhost:${PORT}`);
});
