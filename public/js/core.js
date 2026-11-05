import { demoPlan } from './demo.js';

/* ------------------------------------------------------------- 常量 */

export const OPTIONS = {
  shotSize: ['远景', '全景', '中景', '近景', '特写'],
  direction: ['正面', '斜侧面', '侧面', '背面'],
  angle: ['平拍', '仰拍', '俯拍'],
  focal: ['广角', '中焦', '长焦'],
  composition: ['居中', '三分线', '留白', '对称', '框架', '引导线', '对角线', '前景'],
  light: ['逆光', '侧逆光', '正侧光', '前侧光', '顺光', '柔光'],
};

export const EN = {
  远景: 'EXTREME LONG SHOT', 全景: 'LONG SHOT', 中景: 'MEDIUM SHOT', 近景: 'MEDIUM CLOSE-UP', 特写: 'CLOSE-UP',
  正面: 'FRONT', 斜侧面: 'THREE-QUARTER', 侧面: 'PROFILE', 背面: 'BACK',
  平拍: 'EYE LEVEL', 仰拍: 'LOW ANGLE', 俯拍: 'HIGH ANGLE',
  广角: 'WIDE', 中焦: 'STANDARD', 长焦: 'TELE',
  居中: 'CENTER', 三分线: 'RULE OF THIRDS', 留白: 'NEGATIVE SPACE', 对称: 'SYMMETRY',
  框架: 'FRAMING', 引导线: 'LEADING LINES', 对角线: 'DIAGONAL', 前景: 'FOREGROUND',
  逆光: 'BACKLIGHT', 侧逆光: 'RIM LIGHT', 正侧光: 'SIDE LIGHT', 前侧光: '45° LIGHT',
  顺光: 'FRONT LIGHT', 柔光: 'SOFT LIGHT',
};

export const DIMS = [
  { key: 'prop', label: '道具', en: 'PROPS' },
  { key: 'shotSize', label: '景别', en: 'SHOT SIZE' },
  { key: 'direction', label: '方向', en: 'DIRECTION' },
  { key: 'angle', label: '角度', en: 'ANGLE' },
  { key: 'focal', label: '焦距', en: 'FOCAL LENGTH' },
  { key: 'composition', label: '构图', en: 'COMPOSITION' },
  { key: 'light', label: '光位', en: 'LIGHT' },
];

export const MULTI = { prop: true, composition: true };
const SERIF = '"Songti SC","STSong","Noto Serif SC","SimSun",serif';

/* -------------------------------------------------------------- 状态 */

const LS = {
  plan: 'sp.plan.v2',
  creds: 'sp.creds.v2',
  settings: 'sp.settings.v2',
  meta: 'sp.meta.v2',
};

export const state = {
  plan: null,
  creds: { active: '', list: [] },
  settings: { provider: 'auto', customTpl: '', visionCheck: true, textModel: '', visionModel: '' },
  ui: { dim: null, sel: [], busy: false },
};

/* -------------------------------------------------------------- 工具 */

export function uid(prefix = 's') {
  return prefix + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function debounce(fn, ms = 300) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

export function pad2(n) { return String(n).padStart(2, '0'); }

export function fmtDate(d = new Date()) {
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

export function fmtTime(d = new Date()) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function safeName(s, fallback = '拍摄策划') {
  return String(s || fallback).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || fallback;
}

export function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}

export function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { console.warn('本地存储失败', e); return false; }
}

/* -------------------------------------------------------------- 数据 */

export function emptyPlan() {
  return {
    id: uid('p'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    theme: '',
    concept: '',
    costume: [],
    style: [],
    props: [],
    time: '',
    location: '',
    shots: [],
  };
}

export function newShot(partial = {}) {
  return sanitizeShot(Object.assign({
    id: uid('sh'),
    url: '',
    thumb: '',
    title: '',
    props: [],
    shotSize: '',
    direction: '',
    angle: '',
    focal: '',
    composition: [],
    light: '',
    expression: '',
    action: '',
    note: '',
  }, partial));
}

export function sanitizeShot(s) {
  const oneOf = (v, arr) => (arr.includes(v) ? v : '');
  const many = (v, arr) => (Array.isArray(v) ? v : []).filter((x) => arr.includes(x)).slice(0, 4);
  return {
    id: s.id || uid('sh'),
    url: s.url || '',
    thumb: s.thumb || '',
    title: String(s.title || '').slice(0, 80),
    props: Array.isArray(s.props) ? s.props.filter(Boolean).map((x) => String(x).slice(0, 24)).slice(0, 6) : [],
    shotSize: oneOf(s.shotSize, OPTIONS.shotSize),
    direction: oneOf(s.direction, OPTIONS.direction),
    angle: oneOf(s.angle, OPTIONS.angle),
    focal: oneOf(s.focal, OPTIONS.focal),
    composition: many(s.composition, OPTIONS.composition),
    light: oneOf(s.light, OPTIONS.light),
    expression: String(s.expression || '').slice(0, 80),
    action: String(s.action || '').slice(0, 100),
    note: String(s.note || '').slice(0, 140),
    _src: s._src,
  };
}

export function normalizePlan(p) {
  if (!p || typeof p !== 'object') return emptyPlan();
  const plan = Object.assign(emptyPlan(), p);
  plan.costume = Array.isArray(plan.costume) ? plan.costume.filter(Boolean).map(String) : [];
  plan.style = Array.isArray(plan.style) ? plan.style.filter(Boolean).map(String) : [];
  plan.props = Array.isArray(plan.props) ? plan.props.filter(Boolean).map(String) : [];
  plan.shots = Array.isArray(plan.shots) ? plan.shots.map(sanitizeShot) : [];
  return plan;
}

export function bootData() {
  const saved = readJSON(LS.plan);
  state.plan = saved ? normalizePlan(saved) : demoPlan();
  const creds = readJSON(LS.creds);
  if (creds && Array.isArray(creds.list)) {
    state.creds = creds;
    // 旧配置迁移：deepseek-chat / reasoner 已由 deepseek-flash 取代，且后者支持读图
    let changed = false;
    creds.list.forEach((c) => {
      const isDS = /deepseek\.com/i.test(c.baseUrl || '');
      if (!isDS) return;
      if (c.model === 'deepseek-chat' || c.model === 'deepseek-reasoner') {
        c.model = 'deepseek-flash';
        changed = true;
      }
      // DeepSeek 只有 flash 会读图，v4-pro 不支持
      if (!c.visionModel || c.visionModel === 'deepseek-v4-pro') {
        c.visionModel = 'deepseek-flash';
        changed = true;
      }
    });
    if (changed) writeJSON(LS.creds, creds);
  }
  const settings = readJSON(LS.settings);
  if (settings) state.settings = Object.assign(state.settings, settings);
  state.ui.dim = null;
  state.ui.sel = [];
}

let saveTimer = null;

export function persist(immediate = false) {
  state.plan.updatedAt = Date.now();
  setSaveState('保存中…', true);
  clearTimeout(saveTimer);
  const doSave = () => {
    const data = JSON.stringify(state.plan, (k, v) => (k.charAt(0) === '_' ? undefined : v));
    writeJSON(LS.plan, JSON.parse(data));
    writeJSON(LS.meta, { savedAt: Date.now() });
    setSaveState('已保存 ' + fmtTime(), false);
  };
  if (immediate) doSave();
  else saveTimer = setTimeout(doSave, 320);
}

export function persistCreds() { writeJSON(LS.creds, state.creds); }
export function persistSettings() { writeJSON(LS.settings, state.settings); }

function setSaveState(text, saving) {
  const el = document.getElementById('saveState');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('saving', !!saving);
}

/* --------------------------------------------------------- IndexedDB */

const DB_NAME = 'shoot-plan-assets';
const STORE = 'assets';
let dbPromise = null;

function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function putAsset(id, dataUrl) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(dataUrl, id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAsset(id) {
  const d = await db();
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(id);
    r.onsuccess = () => resolve(r.result || '');
    r.onerror = () => resolve('');
  });
}

export async function delAsset(id) {
  try {
    const d = await db();
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
  } catch (e) { /* ignore */ }
}

export async function hydrateAssets() {
  const jobs = state.plan.shots.filter((s) => s.url && s.url.startsWith('asset:'));
  await Promise.all(jobs.map(async (s) => {
    const id = s.url.slice(6);
    const data = await getAsset(id);
    if (data) s._src = data;
  }));
}

/* ------------------------------------------------------------- 图片 */

export function shotSrc(shot, kind = 'card') {
  if (!shot) return '';
  if (shot._src) return shot._src;
  const u = kind === 'full' ? (shot.url || shot.thumb) : (shot.thumb || shot.url);
  if (!u) return '';
  if (u.startsWith('data:') || u.startsWith('/') || u.startsWith('blob:')) return u;
  return '/api/img?u=' + encodeURIComponent(u);
}

export function loadImage(src, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      img.src = '';
      reject(new Error('图片加载超时'));
    }, timeout);
    img.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error('图片加载失败'));
    };
    img.src = src;
  });
}

export async function toDataUrl(src, max = 1024, quality = 0.82) {
  const img = await loadImage(src);
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const scale = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', quality);
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export async function compressFile(file, max = 1600) {
  const dataUrl = await fileToDataUrl(file);
  try {
    return await toDataUrl(dataUrl, max, 0.87);
  } catch (e) {
    return dataUrl;
  }
}

/* ------------------------------------------------------------- 分组 */

export function propNames() {
  const out = [];
  const push = (v) => { if (v && !out.includes(v)) out.push(v); };
  (state.plan.props || []).forEach(push);
  state.plan.shots.forEach((s) => (s.props || []).forEach(push));
  return out;
}

export function matchesValue(shot, dim, value) {
  if (dim === 'prop') return (shot.props || []).includes(value);
  if (dim === 'composition') return (shot.composition || []).includes(value);
  if (dim === 'light') {
    if (value === '柔光') return !shot.light || shot.light === '柔光';
    return shot.light === value;
  }
  return shot[dim] === value;
}

export function valueCounts(dim) {
  const map = new Map();
  const shots = state.plan.shots;
  if (dim === 'prop') {
    for (const p of propNames()) map.set(p, shots.filter((s) => (s.props || []).includes(p)).length);
    return map;
  }
  for (const v of OPTIONS[dim] || []) map.set(v, shots.filter((s) => matchesValue(s, dim, v)).length);
  return map;
}

export function sectionsFor(dim = state.ui.dim, sel = state.ui.sel) {
  const shotsAll = state.plan.shots;
  let shots = shotsAll.slice();
  if (dim && sel.length) {
    shots = shots.filter((s) => (
      dim === 'prop'
        ? sel.every((v) => matchesValue(s, dim, v))
        : sel.some((v) => matchesValue(s, dim, v))
    ));
  }
  if (!dim) return shots.length ? [{ key: 'all', label: '', en: '', items: shots }] : [];

  if (dim === 'prop') {
    const out = [];
    // 多道具组合：按「具体是哪几件」拆成独立分组，组名直接写明 道具1 ＋ 道具2
    const comboMap = new Map();
    for (const s of shots) {
      const ps = Array.from(new Set((s.props || []).filter(Boolean)));
      if (ps.length < 2) continue;
      const sorted = ps.slice().sort((a, b) => a.localeCompare(b, 'zh'));
      const key = sorted.join('|');
      let g = comboMap.get(key);
      if (!g) {
        g = { key: 'combo:' + key, label: ps.join(' ＋ '), en: 'PROP COMBO', items: [], combo: true };
        comboMap.set(key, g);
      }
      g.items.push(s);
    }
    const comboList = Array.from(comboMap.values())
      .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, 'zh'));
    out.push(...comboList);
    for (const name of propNames()) {
      const items = shots.filter((s) => (s.props || []).includes(name));
      if (items.length) out.push({ key: name, label: name, en: 'PROP', items });
    }
    return out;
  }
  return (OPTIONS[dim] || [])
    .map((v) => ({ key: v, label: v, en: EN[v] || '', items: shots.filter((s) => matchesValue(s, dim, v)) }))
    .filter((x) => x.items.length);
}

export function shotTags(shot) {
  const tags = [];
  const add = (k, v, key) => { if (v) tags.push({ k, v, key }); };
  add('景别', shot.shotSize, 'shotSize');
  add('方向', shot.direction, 'direction');
  add('角度', shot.angle, 'angle');
  add('焦距', shot.focal, 'focal');
  if ((shot.composition || []).length) add('构图', shot.composition.join(' · '), 'composition');
  add('光位', shot.light, 'light');
  if ((shot.props || []).length) add('道具', shot.props.join(' ＋ '), 'prop');
  return tags;
}

export function activeDimLabel() {
  const d = DIMS.find((x) => x.key === state.ui.dim);
  return d ? d.label : '';
}

/* --------------------------------------------------------------- UI */

export function toast(msg, type = '') {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 320);
  }, 2600);
}

export function openModal(innerHtml, opts = {}) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop">${innerHtml}</div>`;
  const backdrop = root.firstElementChild;
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.innerHTML = '';
    document.body.style.overflow = prevOverflow;
    if (opts.onClose) opts.onClose();
  };
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  return { close, el: backdrop.firstElementChild, backdrop };
}

export function confirmDialog(message, okText = '确定') {
  return new Promise((resolve) => {
    let done = false;
    const modal = openModal(`
      <div class="modal" style="width:min(430px,100%)">
        <div class="modal-head"><h3 style="font-size:19px">请确认</h3><button class="x" data-close>×</button></div>
        <div style="padding:20px 28px;font-size:13px;line-height:1.85;color:var(--ink-2)">${message}</div>
        <div class="modal-foot">
          <div class="grow"></div>
          <button class="btn" data-no>取消</button>
          <button class="btn primary" data-yes>${esc(okText)}</button>
        </div>
      </div>`, { onClose: () => { if (!done) resolve(false); } });
    modal.el.querySelector('[data-yes]').addEventListener('click', () => { done = true; modal.close(); resolve(true); });
    modal.el.querySelector('[data-no]').addEventListener('click', () => { done = true; modal.close(); resolve(false); });
  });
}

export function chipEditor(container, items, onChange, placeholder = '添加') {
  const list = items.slice();
  container.innerHTML = list.map((t, i) => (
    `<span class="chip"><span>${esc(t)}</span><button class="cx" data-i="${i}" title="移除">×</button></span>`
  )).join('') + `<button class="chip-add" type="button">＋ ${esc(placeholder)}</button>`;

  container.querySelectorAll('.cx').forEach((b) => {
    b.addEventListener('click', () => {
      const next = list.slice();
      next.splice(Number(b.dataset.i), 1);
      onChange(next);
    });
  });
  const addBtn = container.querySelector('.chip-add');
  addBtn.addEventListener('click', () => {
    if (container.querySelector('.chip-input')) return;
    const input = document.createElement('input');
    input.className = 'chip-input';
    input.type = 'text';
    input.placeholder = '输入后回车';
    addBtn.replaceWith(input);
    input.focus();
    let committed = false;
    const commit = (save) => {
      if (committed) return;
      committed = true;
      const v = input.value.trim();
      if (save && v && !list.includes(v)) {
        const next = list.concat(v);
        onChange(next);
      } else {
        chipEditor(container, list, onChange, placeholder);
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
  });
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

export const drawFonts = { serif: SERIF };
