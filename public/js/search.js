import { state } from './core.js';

export async function searchImages(q, n = 12) {
  const s = state.settings || {};
  const url = `/api/images?q=${encodeURIComponent(q)}&n=${n}`
    + `&provider=${encodeURIComponent(s.provider || 'auto')}`
    + `&tpl=${encodeURIComponent(s.customTpl || '')}`;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({ error: '图源返回异常' }));
  if (!r.ok) throw new Error(j.error || '图片检索失败');
  return (j.items || []).map((x) => ({
    url: x.url,
    thumb: x.thumb || '',
    title: x.title || '',
    source: x.source || '',
    query: q,
  }));
}

/** 依次执行多组检索，去重后收集到 target 张 */
export async function collectImages(queries, target, onTick) {
  const seen = new Set();
  const out = [];
  for (const qr of queries) {
    if (out.length >= target) break;
    let items = [];
    try {
      items = await searchImages(qr.q, qr.n || 12);
    } catch (e) {
      console.warn('[search]', qr.q, e.message);
      continue;
    }
    for (const it of items) {
      const key = String(it.url || '').split('?')[0].toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(it);
      if (out.length >= target) break;
    }
    if (onTick) onTick(out.length, qr.q);
  }
  return out;
}

export function previewQueries(group) {
  const kws = (group.keywords || []).filter(Boolean);
  const q = kws.length ? kws : [group.theme || group.name || 'portrait photography'];
  return q.slice(0, 3);
}

export function buildQueries(group, total = 22) {
  const kws = (group.keywords || []).filter(Boolean);
  const theme = group.theme || group.name || '';
  const list = [];
  const push = (q, n) => {
    if (!q) return;
    if (list.some((x) => x.q === q)) return;
    list.push({ q, n });
  };

  if (kws.length) {
    push(kws[0], Math.ceil(total * 0.4));
    if (kws[1]) push(kws[1], Math.ceil(total * 0.28));
    if (kws[2]) push(kws[2], Math.ceil(total * 0.2));
    if (kws[3]) push(kws[3], 6);
  }
  if (theme) push(theme, 8);
  // 兜底：风格 + 人物
  if (kws.length) push(kws[0] + ' photography', 6);
  else push('portrait photography', 8);
  return list;
}
