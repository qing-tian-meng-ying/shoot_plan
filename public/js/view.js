import {
  state, OPTIONS, DIMS, EN, esc, persist, chipEditor, openModal, confirmDialog, toast,
  newShot, sanitizeShot, shotSrc, sectionsFor, propNames, shotTags, valueCounts,
  compressFile, putAsset, delAsset, uid, fmtDate, pad2, debounce,
} from './core.js';
import { analyzeShot, hasCred, hasVision, autoVision } from './ai.js';
import { openXhsImport } from './xhs.js';

const $ = (id) => document.getElementById(id);
let fileInput = null;
let schedulePersist = debounce(() => persist(), 500);

/* ------------------------------------------------------------ 渲染 */

export function renderAll() {
  renderCover();
  renderToolbar();
  renderGrid();
  renderFoot();
}

function setText(el, v) {
  if (!el) return;
  if (document.activeElement === el) return;
  if ((el.textContent || '') === (v || '')) return;
  el.textContent = v || '';
}

export function renderCover() {
  const p = state.plan;
  setText($('fTheme'), p.theme);
  setText($('fConcept'), p.concept);
  setText($('fTime'), p.time);
  setText($('fLocation'), p.location);

  const meta = $('planMeta');
  if (meta) meta.textContent = `${fmtDate(new Date(p.updatedAt || Date.now()))} · ${p.shots.length} SHOTS`;

  renderChipList($('fCostume'), p.costume, '添加服装', (next) => { p.costume = next; persist(); renderAll(); });
  renderChipList($('fStyle'), p.style, '添加风格', (next) => { p.style = next; persist(); renderAll(); });
  renderChipList($('fProps'), p.props, '添加道具', (next) => { p.props = next; persist(); renderAll(); });
}

function renderChipList(el, items, placeholder, onChange) {
  if (!el) return;
  if (document.activeElement && el.contains(document.activeElement)) return;
  chipEditor(el, items || [], onChange, placeholder);
}

export function renderToolbar() {
  const el = $('dims');
  if (!el) return;
  const dim = state.ui.dim;
  el.innerHTML = `<button class="dim ${!dim ? 'on' : ''}" data-dim="">全部</button>`
    + DIMS.map((d) => `<button class="dim ${dim === d.key ? 'on' : ''}" data-dim="${d.key}">${d.label}</button>`).join('');

  const values = $('values');
  if (!dim) {
    values.hidden = true;
    values.innerHTML = '';
    return;
  }
  values.hidden = false;
  const counts = valueCounts(dim);
  const vals = dim === 'prop' ? propNames() : (OPTIONS[dim] || []);
  const total = state.plan.shots.length;
  values.innerHTML = `<button class="pchip ${state.ui.sel.length ? '' : 'on'}" data-val="">全部<b>${total}</b></button>`
    + vals.map((v) => {
      const on = state.ui.sel.includes(v);
      const c = counts.get(v) || 0;
      return `<button class="pchip ${on ? 'on' : ''}" data-val="${esc(v)}"${c ? '' : ' disabled style="opacity:.4"'}>${esc(v)}<b>${c}</b></button>`;
    }).join('');
}

export function renderGrid() {
  const wrap = $('grid');
  const p = state.plan;
  const count = $('shotCount');
  if (count) count.textContent = p.shots.length;

  if (!p.shots.length) {
    wrap.innerHTML = `<div class="empty">
      <h3>从一张参考图开始</h3>
      <p>添加图片后，可按道具、景别、方向、角度、焦距、构图、光位自动编排；也可以让 AI 从一个主题直接写出整套方案。</p>
      <div class="empty-actions">
        <button class="btn primary" data-act="add">＋ 添加图片</button>
        <button class="btn" data-act="xhs">从小红书导入</button>
        <button class="btn" data-act="wizard">AI 自动策划</button>
      </div>
    </div>`;
    return;
  }

  const secs = sectionsFor();
  if (!secs.length) {
    wrap.innerHTML = `<div class="empty">
      <h3>这个筛选下没有图片</h3>
      <p>当前维度没有匹配的镜头，取消筛选或换一个编排方式试试。</p>
      <div class="empty-actions"><button class="btn" data-act="clear-filter">清除筛选</button></div>
    </div>`;
    return;
  }

  wrap.innerHTML = secs.map((sec) => {
    const head = state.ui.dim ? groupHead(sec, sec.items.length) : '';
    return `<section class="group">${head}<div class="grid">${sec.items.map(cardHtml).join('')}</div></section>`;
  }).join('');
}

function groupHead(sec) {
  return `<div class="group-head">
    <span class="gname">${esc(sec.label)}</span>
    <span class="gen">${esc(sec.en || '')}</span>
    <i class="gline"></i>
    <span class="gcount">${sec.items.length}</span>
  </div>`;
}

function cardHtml(s) {
  const idx = state.plan.shots.indexOf(s) + 1;
  const src = shotSrc(s, 'card');
  const tags = shotTags(s);
  const dim = state.ui.dim;
  const tagHtml = tags.map((t) => `<span class="tag ${dim && t.key === dim ? 'hot' : ''}"><b>${t.k}</b>${esc(t.v)}</span>`).join('');
  const expr = (s.expression || '').trim();
  const act = (s.action || '').trim();
  const showExpr = expr && !/^[—\-－]+$/.test(expr);
  const showAct = act && !/^[—\-－]+$/.test(act);
  const cap = `${s.title ? `<p class="ctitle">${esc(s.title)}</p>` : ''}${(showExpr || showAct)
    ? `${showExpr ? `<p class="say"><b>神态</b>${esc(expr)}</p>` : ''}
       ${showAct ? `<p class="say"><b>动作</b>${esc(act)}</p>` : ''}`
    : `<p class="say" style="color:var(--muted)">待补充注释</p>`}`;

  return `<article class="card" data-id="${s.id}" id="card-${s.id}">
    <div class="ph">
      ${src ? `<img src="${esc(src)}" alt="${esc(s.title || '')}" loading="lazy">` : `<div class="ph-empty">无图片</div>`}
      <span class="idx">${pad2(idx)}</span>
      <div class="acts">
        <button data-act="up" title="前移">←</button>
        <button data-act="down" title="后移">→</button>
        <button data-act="ai" title="AI 识别属性">识别</button>
        <button data-act="edit">编辑</button>
      </div>
    </div>
    <div class="cap">${cap}${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}</div>
    <div class="tags">${tagHtml}</div>
  </article>`;
}

export function renderFoot() {
  const t = $('footTheme');
  if (t) t.textContent = state.plan.theme || '未命名';
  const d = $('footDate');
  if (d) d.textContent = `${fmtDate(new Date(state.plan.updatedAt || Date.now()))} · ${state.plan.shots.length} FRAMES`;
}

/* --------------------------------------------------------- 封面绑定 */

export function initCover() {
  bindEditable('fTheme', 'theme', true);
  bindEditable('fConcept', 'concept', false);
  bindEditable('fTime', 'time', true);
  bindEditable('fLocation', 'location', true);
}

function bindEditable(id, key, single) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('input', () => {
    const v = el.textContent.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n');
    state.plan[key] = single ? v.replace(/\s+/g, ' ').trim() : v.trim();
    if (!el.textContent.trim()) el.innerHTML = '';
    if (key === 'theme') {
      const f = $('footTheme');
      if (f) f.textContent = state.plan.theme || '未命名';
    }
    schedulePersist();
  });
  el.addEventListener('blur', () => {
    state.plan[key] = el.textContent.trim();
    persist();
    renderFoot();
  });
  el.addEventListener('keydown', (e) => {
    if (single && e.key === 'Enter') { e.preventDefault(); el.blur(); }
  });
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const txt = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\s+/g, ' ');
    document.execCommand('insertText', false, txt);
  });
}

/* --------------------------------------------------------- 添加图片 */

export function initFileInput() {
  fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (files.length) addImageFiles(files);
  });
}

export function pickImages() {
  if (fileInput) fileInput.click();
}

export function importFromXhs() {
  openXhsImport({
    maxSize: 1600,
    onDone: async (items) => {
      const created = [];
      for (const it of items) {
        try {
          const id = uid('img');
          await putAsset(id, it.dataUrl);
          const s = newShot({ url: 'asset:' + id, _src: it.dataUrl });
          state.plan.shots.push(s);
          created.push(s);
        } catch (e) {
          console.warn('小红书图片入库失败', e);
        }
      }
      if (!created.length) return;
      persist();
      renderAll();
      if (autoVision() && state.settings.visionCheck) batchAnalyze(created);
    },
  });
}

export async function addImageFiles(files) {
  const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
  if (!list.length) { toast('请选择图片文件', 'warn'); return; }
  toast(`正在处理 ${list.length} 张图片…`);
  const created = [];
  for (const f of list) {
    try {
      const dataUrl = await compressFile(f, 1600);
      const id = uid('img');
      await putAsset(id, dataUrl);
      const s = newShot({
        url: 'asset:' + id,
        _src: dataUrl,
        title: f.name.replace(/\.[^.]+$/, '').slice(0, 30),
      });
      state.plan.shots.push(s);
      created.push(s);
    } catch (e) {
      console.warn('图片处理失败', e);
    }
  }
  persist();
  renderAll();
  if (!created.length) { toast('图片处理失败', 'warn'); return; }
  toast(`已添加 ${created.length} 张，可编辑属性`);

  if (autoVision() && state.settings.visionCheck) {
    if (created.length === 1) {
      const ed = openEditor(created[0].id, { fresh: true });
      if (ed) ed.runAI();
    } else {
      batchAnalyze(created);
    }
  } else if (created.length === 1) {
    openEditor(created[0].id, { fresh: true });
  }
}

async function batchAnalyze(shots) {
  let ok = 0;
  for (let i = 0; i < shots.length; i++) {
    toast(`AI 识别中 ${i + 1}/${shots.length}`);
    try {
      const r = await analyzeShot(shots[i], { theme: state.plan.theme });
      const s = shots[i];
      if (!s.shotSize) s.shotSize = r.shotSize;
      if (!s.direction) s.direction = r.direction;
      if (!s.angle) s.angle = r.angle;
      if (!s.focal) s.focal = r.focal;
      if (!s.composition.length) s.composition = r.composition;
      if (!s.light) s.light = r.light;
      if (!s.props.length) s.props = r.props;
      if (!s.expression) s.expression = r.expression;
      if (!s.action) s.action = r.action;
      ok++;
    } catch (e) {
      console.warn('识别失败', e.message);
      break;
    }
  }
  persist();
  renderAll();
  toast(ok ? `AI 已填充 ${ok} 张，请逐张确认` : 'AI 识别失败，可手动填写', ok ? '' : 'warn');
}

/* --------------------------------------------------------- 镜头编辑 */

function segField(label, name, options, hint = '') {
  return `<div class="field">
    <label>${label}${hint ? ' <span style="letter-spacing:0;text-transform:none;color:#b3a99a">' + hint + '</span>' : ''}</label>
    <div class="seg" data-name="${name}">${options.map((v) => `<button type="button" data-v="${v}">${v}</button>`).join('')}</div>
  </div>`;
}

export function openEditor(shotId, opts = {}) {
  const plan = state.plan;
  const shot = plan.shots.find((s) => s.id === shotId);
  if (!shot) return null;
  const idx = plan.shots.indexOf(shot) + 1;
  let draft = JSON.parse(JSON.stringify({
    title: shot.title, expression: shot.expression, action: shot.action, note: shot.note,
    props: shot.props.slice(), shotSize: shot.shotSize, direction: shot.direction,
    angle: shot.angle, focal: shot.focal, composition: shot.composition.slice(), light: shot.light,
  }));

  const src = shotSrc(shot, 'card');
  const allProps = propNames();

  const modal = openModal(`
    <div class="modal">
      <div class="modal-head">
        <div>
          <div class="ed-kicker">SHOT ${pad2(idx)} / ${pad2(plan.shots.length)}${opts.fresh ? ' · 新图片' : ''}</div>
          <h3>编辑镜头</h3>
        </div>
        <button class="x" data-close title="关闭">×</button>
      </div>
      <div class="ed-body">
        <div class="ed-media">
          <div class="frame"><img id="edImg" src="${esc(src)}" alt=""></div>
          <div class="media-acts">
            <button type="button" class="link" id="edReplace">更换图片</button>
            <button type="button" class="link" id="edAI">AI 识别属性</button>
          </div>
          <div class="ai-state" id="edAIState"></div>
        </div>
        <div class="ed-fields">
          <div class="field"><label>画面标题</label><input type="text" id="edTitle" placeholder="例：窗边的第三个下午"></div>
          <div class="row2">
            <div class="field"><label>神态 / 表情</label><input type="text" id="edExpr" placeholder="例：不笑，眼神有焦距"></div>
            <div class="field"><label>动作引导</label><input type="text" id="edAct" placeholder="例：双手环杯，拇指摩挲杯口"></div>
          </div>
          <div class="field"><label>补充说明</label><textarea id="edNote" placeholder="机位、节奏、备用方案…"></textarea></div>
          ${segField('景别', 'shotSize', OPTIONS.shotSize)}
          ${segField('拍摄方向', 'direction', OPTIONS.direction)}
          ${segField('拍摄角度', 'angle', OPTIONS.angle)}
          ${segField('拍摄焦距', 'focal', OPTIONS.focal)}
          ${segField('构图', 'composition', OPTIONS.composition, '可多选')}
          ${segField('光位', 'light', OPTIONS.light)}
          <div class="field"><label>道具 <span style="letter-spacing:0;text-transform:none;color:#b3a99a">可多选，用于道具编排</span></label>
            <div class="chip-edit" id="edProps"></div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn danger" id="edDel">删除</button>
        <div class="grow"></div>
        <button class="btn" data-close>取消</button>
        <button class="btn primary" id="edSave">保存</button>
      </div>
    </div>`, { onClose: opts.onClose });

  const el = modal.el;
  const aiState = el.querySelector('#edAIState');
  const setState = (t, cls = '') => { aiState.textContent = t; aiState.className = 'ai-state ' + cls; };

  function fill() {
    el.querySelector('#edTitle').value = draft.title || '';
    el.querySelector('#edExpr').value = draft.expression || '';
    el.querySelector('#edAct').value = draft.action || '';
    el.querySelector('#edNote').value = draft.note || '';
    el.querySelectorAll('.seg').forEach((seg) => {
      const name = seg.dataset.name;
      const val = draft[name];
      seg.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('on', Array.isArray(val) ? val.includes(b.dataset.v) : val === b.dataset.v);
      });
    });
    renderProps();
  }

  function renderProps() {
    const box = el.querySelector('#edProps');
    chipEditor(box, draft.props, (next) => { draft.props = next; renderProps(); }, '添加道具');
    box.querySelector('.chip-add').setAttribute('title', allProps.length ? '常用：' + allProps.join('、') : '');
  }

  el.querySelectorAll('.seg').forEach((seg) => {
    const name = seg.dataset.name;
    seg.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (name === 'composition') {
          const v = btn.dataset.v;
          const i = draft.composition.indexOf(v);
          if (i >= 0) draft.composition.splice(i, 1);
          else draft.composition.push(v);
        } else {
          draft[name] = draft[name] === btn.dataset.v ? '' : btn.dataset.v;
        }
        fill();
      });
    });
  });

  el.querySelector('#edSave').addEventListener('click', () => {
    draft.title = el.querySelector('#edTitle').value.trim();
    draft.expression = el.querySelector('#edExpr').value.trim();
    draft.action = el.querySelector('#edAct').value.trim();
    draft.note = el.querySelector('#edNote').value.trim();
    const clean = sanitizeShot(Object.assign({}, shot, draft, { id: shot.id, url: shot.url, thumb: shot.thumb, _src: shot._src }));
    Object.assign(shot, clean);
    persist();
    renderAll();
    modal.close();
    toast('已保存');
  });

  el.querySelector('#edDel').addEventListener('click', async () => {
    modal.close();
    await removeShot(shot.id);
  });

  el.querySelector('#edReplace').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      setState('正在替换图片…');
      try {
        const dataUrl = await compressFile(f, 1600);
        const id = uid('img');
        await putAsset(id, dataUrl);
        if (shot.url.startsWith('asset:')) delAsset(shot.url.slice(6));
        shot.url = 'asset:' + id;
        shot._src = dataUrl;
        el.querySelector('#edImg').src = dataUrl;
        setState('图片已替换', 'ok');
      } catch (e) {
        setState('替换失败：' + e.message, 'err');
      }
    });
    inp.click();
  });

  const aiBtn = el.querySelector('#edAI');
  aiBtn.addEventListener('click', async () => {
    if (!hasCred()) { setState('请先在设置里配置模型接口', 'err'); return; }
    if (!hasVision()) { setState('接口缺少可用的模型名。请在设置里填写模型（视觉模型留空时会沿用文本模型）。', 'err'); return; }
    aiBtn.disabled = true;
    setState('识别中，请稍候…');
    try {
      const r = await analyzeShot(shot, { theme: plan.theme });
      draft.title = r.title || draft.title;
      if (r.props.length) draft.props = r.props;
      draft.shotSize = r.shotSize || draft.shotSize;
      draft.direction = r.direction || draft.direction;
      draft.angle = r.angle || draft.angle;
      draft.focal = r.focal || draft.focal;
      if (r.composition.length) draft.composition = r.composition;
      draft.light = r.light || draft.light;
      draft.expression = r.expression || draft.expression;
      draft.action = r.action || draft.action;
      fill();
      setState('AI 已填写，请确认后保存', 'ok');
    } catch (e) {
      setState('识别失败：' + e.message, 'err');
    } finally {
      aiBtn.disabled = false;
    }
  });

  el.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      el.querySelector('#edSave').click();
    }
  });

  fill();
  setTimeout(() => {
    const t = el.querySelector('#edTitle');
    if (t) t.focus();
  }, 60);

  return { close: modal.close, runAI: () => aiBtn.click(), setState };
}

/* --------------------------------------------------------- 删除/排序 */

export async function removeShot(id) {
  const shot = state.plan.shots.find((s) => s.id === id);
  if (!shot) return;
  const ok = await confirmDialog('删除这张图片及其注释？此操作不可撤销。', '删除');
  if (!ok) return;
  state.plan.shots = state.plan.shots.filter((s) => s.id !== id);
  if (shot.url && shot.url.startsWith('asset:')) delAsset(shot.url.slice(6));
  persist();
  renderAll();
  toast('已删除');
}

export function moveShot(id, dir) {
  const i = state.plan.shots.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.plan.shots.length) return;
  const arr = state.plan.shots;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  persist();
  renderAll();
}

export function applyGeneratedPlan(plan) {
  state.plan = plan;
  state.ui.dim = null;
  state.ui.sel = [];
  persist(true);
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------------------------------------------------- 事件绑定 */

export function initView() {
  initFileInput();
  initCover();

  const dims = $('dims');
  dims.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dim]');
    if (!btn) return;
    const key = btn.dataset.dim;
    state.ui.dim = key || null;
    state.ui.sel = [];
    renderToolbar();
    renderGrid();
  });

  const values = $('values');
  values.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-val]');
    if (!btn) return;
    const v = btn.dataset.val;
    const dim = state.ui.dim;
    if (!v) {
      state.ui.sel = [];
    } else if (dim === 'prop' || dim === 'composition') {
      const i = state.ui.sel.indexOf(v);
      if (i >= 0) state.ui.sel.splice(i, 1);
      else state.ui.sel.push(v);
    } else {
      state.ui.sel = state.ui.sel.includes(v) ? [] : [v];
    }
    renderToolbar();
    renderGrid();
  });

  const grid = $('grid');
  grid.addEventListener('click', async (e) => {
    const actEl = e.target.closest('[data-act]');
    if (actEl && !e.target.closest('.card')) {
      const act = actEl.dataset.act;
      if (act === 'add') pickImages();
      if (act === 'xhs') importFromXhs();
      if (act === 'wizard') document.dispatchEvent(new CustomEvent('sp:wizard'));
      if (act === 'clear-filter') { state.ui.sel = []; renderToolbar(); renderGrid(); }
      return;
    }
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    const act = actEl ? actEl.dataset.act : 'edit';
    if (act === 'edit') openEditor(id);
    else if (act === 'ai') {
      const shot = state.plan.shots.find((s) => s.id === id);
      if (!shot) return;
      if (!hasCred()) { toast('请先在设置里配置模型接口', 'warn'); return; }
      if (!hasVision()) { toast('接口缺少模型名，请先到设置里填写', 'warn'); return; }
      toast('识别中…');
      try {
        const r = await analyzeShot(shot, { theme: state.plan.theme });
        Object.assign(shot, sanitizeShot(Object.assign({}, shot, {
          title: shot.title || r.title,
          props: shot.props.length ? shot.props : r.props,
          shotSize: shot.shotSize || r.shotSize,
          direction: shot.direction || r.direction,
          angle: shot.angle || r.angle,
          focal: shot.focal || r.focal,
          composition: shot.composition.length ? shot.composition : r.composition,
          light: shot.light || r.light,
          expression: shot.expression || r.expression,
          action: shot.action || r.action,
        })));
        persist();
        renderAll();
        toast('AI 已填写，点击「编辑」可确认修改');
      } catch (err) {
        toast('识别失败：' + err.message, 'warn');
      }
    } else if (act === 'up') moveShot(id, -1);
    else if (act === 'down') moveShot(id, 1);
  });

  const addBtn = $('btnAdd');
  const addMenu = $('addMenu');
  if (addBtn && addMenu) {
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      addMenu.hidden = !addMenu.hidden;
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#addWrap')) addMenu.hidden = true;
    });
    addMenu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      addMenu.hidden = true;
      if (b.dataset.act === 'local') pickImages();
      if (b.dataset.act === 'xhs') importFromXhs();
    });
  }

  const shotsSec = $('shots');
  if (shotsSec) {
    ['dragenter', 'dragover'].forEach((evt) => shotsSec.addEventListener(evt, (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      shotsSec.style.outline = '1px dashed var(--accent)';
      shotsSec.style.outlineOffset = '10px';
    }));
    ['dragleave', 'drop'].forEach((evt) => shotsSec.addEventListener(evt, (e) => {
      if (evt === 'drop') e.preventDefault();
      shotsSec.style.outline = '';
      shotsSec.style.outlineOffset = '';
    }));
    shotsSec.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) addImageFiles(files);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input,textarea,[contenteditable]')) return;
    if (e.key === 'Escape' && state.ui.sel.length) {
      state.ui.sel = [];
      renderToolbar();
      renderGrid();
    }
  });
}
