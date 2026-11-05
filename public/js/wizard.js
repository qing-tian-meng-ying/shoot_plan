import {
  state, esc, uid, toast, normalizePlan, chipEditor, compressFile, putAsset,
} from './core.js';
import {
  generateGroups, analyzeShot, composePlan, hasCred, hasVision, autoVision, shotsFrom, activeCred,
} from './ai.js';
import { searchImages, collectImages, buildQueries, previewQueries } from './search.js';
import { applyGeneratedPlan } from './view.js';
import { openSettings } from './settings.js';
import { openXhsImport } from './xhs.js';

let W = null;
const root = () => document.getElementById('wizardRoot');

export function openWizard() {
  W = {
    step: 1,
    theme: '',
    refs: [],
    extra: { style: [], costume: [], props: [], time: '', location: '' },
    groups: [],
    selected: -1,
    mode: '',
    error: '',
    progress: [],
    busy: false,
    plan: null,
  };
  document.body.style.overflow = 'hidden';
  render();
}

function closeWizard() {
  root().innerHTML = '';
  document.body.style.overflow = '';
  W = null;
}

function thumbUrl(it) {
  const u = (it && (it.thumb || it.url)) || '';
  if (!u) return '';
  if (u.startsWith('data:') || u.startsWith('/')) return u;
  return '/api/img?u=' + encodeURIComponent(u);
}

function steps(active) {
  const names = ['01 输入', '02 选方向', '03 生成'];
  return `<div class="wz-steps">${names.map((n, i) => {
    const no = i + 1;
    const cls = no === active ? 'on' : (no < active ? 'done' : '');
    return `<span class="${cls}">${n}</span>`;
  }).join('<i></i>')}</div>`;
}

function errorBox() {
  if (!W || !W.error) return '';
  const needSettings = /视觉模型|模型接口/.test(W.error);
  return `<div class="wz-error"><b>出错了</b>${esc(W.error)}${needSettings
    ? '<div style="margin-top:10px"><button class="btn" data-wz-settings>打开设置</button></div>'
    : ''}</div>`;
}

/* ------------------------------------------------------------- render */

function render() {
  if (!W) return;
  const el = root();
  let inner = '';
  if (W.step === 1) inner = step1();
  else if (W.step === 2) inner = step2();
  else if (W.step === 3) inner = step3();
  else inner = step4();
  el.innerHTML = `<div class="wizard">
    <div class="wz-top">
      <div class="wz-brand">拍摄策划 <span>AI 自动策划</span></div>
      <button class="x" id="wzClose" title="关闭">×</button>
    </div>
    <div class="wz-inner">${inner}</div>
  </div>`;
  bindCommon();
  if (W.step === 1) bindStep1();
  if (W.step === 2) bindStep2();
  if (W.step === 4) bindStep4();
}

function bindCommon() {
  const c = document.getElementById('wzClose');
  if (c) c.addEventListener('click', closeWizard);
  document.querySelectorAll('[data-wz-settings]').forEach((b) => {
    b.addEventListener('click', () => openSettings());
  });
}

/* -------------------------------------------------------------- step 1 */

function step1() {
  const busy = W.busy;
  const cred = activeCred();
  return `${steps(1)}
  <h2 class="wz-h">从一个念头开始</h2>
  <p class="wz-sub">给一个主题，或几张参考图。服装、风格、道具、时间、地点这些，AI 会先替你补齐，再由你确认取舍；也可以跳过方向，直接按你上传的图写。</p>
  <textarea class="theme-input" id="wzTheme" placeholder="例如：雨天的老咖啡馆，一个人的下午 / 复古胶片感的城市夜行 / 毕业写真 · 白裙与向日葵">${esc(W.theme)}</textarea>
  <div class="refs">
    <div class="ref-grid" id="wzRefs"></div>
    <div class="drop" id="wzDrop">拖入参考图，或点击上传（张数不限 · 可不传）</div>
    <input type="file" id="wzFile" accept="image/*" multiple hidden>
    <button type="button" class="link" id="wzXhs" style="margin-top:9px">从小红书笔记链接导入参考图 →</button>
  </div>
  <details class="more" ${W.extra.style.length || W.extra.costume.length || W.extra.props.length ? 'open' : ''}>
    <summary>补充信息（可选，但给了会更准）</summary>
    <div class="more-grid">
      <div><label>风格形式</label><div class="chips" id="wzStyle"></div></div>
      <div><label>服装期望</label><div class="chips" id="wzCostume"></div></div>
      <div class="full"><label>已有道具</label><div class="chips" id="wzProps"></div></div>
      <div><label>时间</label><input type="text" id="wzTime" placeholder="如：11 月周六下午 · 阴雨" value="${esc(W.extra.time)}"></div>
      <div><label>地点</label><input type="text" id="wzLoc" placeholder="如：老城区咖啡馆靠窗位" value="${esc(W.extra.location)}"></div>
    </div>
  </details>
  <div class="wz-actions">
    <button class="btn primary lg" id="wzGo" ${busy ? 'disabled' : ''}>${busy ? '正在生成视觉方向…' : '生成 3 个视觉方向 →'}</button>
    <button class="btn lg" id="wzSkip" ${W.refs.length ? '' : 'disabled'}>${W.refs.length ? `跳过方向 · 直接用 ${W.refs.length} 张图写策划` : '跳过方向 · 直接用上传图写策划'}</button>
    <span class="wz-note">${cred ? '当前接口：' + esc(cred.name || cred.model) : '<b>尚未配置模型接口</b>'}</span>
    ${cred ? '' : '<button class="btn" id="wzToSettings">打开设置</button>'}
  </div>
  ${errorBox()}`;
}

function bindStep1() {
  const el = root();
  const themeEl = document.getElementById('wzTheme');
  const timeEl = document.getElementById('wzTime');
  const locEl = document.getElementById('wzLoc');
  const sync = () => {
    W.theme = themeEl.value;
    W.extra.time = timeEl.value;
    W.extra.location = locEl.value;
  };
  [themeEl, timeEl, locEl].forEach((i) => i.addEventListener('input', sync));

  const bindChips = (id, key, ph) => {
    const box = document.getElementById(id);
    if (!box) return;
    const draw = () => chipEditor(box, W.extra[key], (next) => { W.extra[key] = next; draw(); }, ph);
    draw();
  };
  bindChips('wzStyle', 'style', '添加风格');
  bindChips('wzCostume', 'costume', '添加服装');
  bindChips('wzProps', 'props', '添加道具');

  renderRefs();

  const drop = document.getElementById('wzDrop');
  const file = document.getElementById('wzFile');
  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    handleRefFiles(file.files);
    file.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('hot');
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove('hot');
  }));
  drop.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) handleRefFiles(e.dataTransfer.files);
  });

  const go = document.getElementById('wzGo');
  if (go) go.addEventListener('click', () => { sync(); startGroups(); });

  const skipBtn = document.getElementById('wzSkip');
  if (skipBtn) skipBtn.addEventListener('click', () => { sync(); generateFromRefs(); });

  const ts = document.getElementById('wzToSettings');
  if (ts) ts.addEventListener('click', () => openSettings());

  const xhsBtn = document.getElementById('wzXhs');
  if (xhsBtn) xhsBtn.addEventListener('click', () => {
    openXhsImport({
      maxSize: 1400,
      onDone: (items) => {
        items.forEach((it) => W.refs.push(it.dataUrl));
        renderRefs();
      },
    });
  });
}

async function handleRefFiles(files) {
  const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
  if (!list.length) return;
  if (list.length > 3) toast(`正在处理 ${list.length} 张图片…`);
  for (const f of list) {
    try {
      W.refs.push(await compressFile(f, 1400));
    } catch (e) { /* ignore */ }
  }
  renderRefs();
  if (W.refs.length > 20) toast('图片较多，逐张识别会比较久', 'warn');
}

function renderRefs() {
  const box = document.getElementById('wzRefs');
  if (!box) return;
  box.innerHTML = W.refs.map((u, i) => (
    `<div class="ref"><img src="${u}" alt=""><button data-rm="${i}" title="移除">×</button></div>`
  )).join('');
  box.querySelectorAll('[data-rm]').forEach((b) => {
    b.addEventListener('click', () => {
      W.refs.splice(Number(b.dataset.rm), 1);
      renderRefs();
    });
  });

  const skip = document.getElementById('wzSkip');
  if (skip) {
    skip.disabled = !W.refs.length;
    skip.textContent = W.refs.length
      ? `跳过方向 · 直接用 ${W.refs.length} 张图写策划`
      : '跳过方向 · 直接用上传图写策划';
  }
}

/* -------------------------------------------------------------- step 2 */

function step2() {
  return `${steps(2)}
  <h2 class="wz-h">选一个方向</h2>
  <p class="wz-sub">三组方向在光线、色调与场景上刻意拉开差距。点标签可以去掉不想要的服装、风格或道具，剩下的会带进正式策划。</p>
  <div class="gcards">${W.groups.map((g, i) => gcard(g, i)).join('')}</div>
  <div class="wz-actions">
    <button class="btn" id="wzBack">← 返回修改</button>
    <button class="btn" id="wzAgain">换一批方向</button>
    <span class="wz-note">选中后会在后台检索 20+ 张参考图，并逐张识别属性。</span>
  </div>
  ${errorBox()}`;
}

function gcard(g, i) {
  const cells = [0, 1, 2, 3].map((j) => {
    const it = g.preview[j];
    return `<div>${it ? `<img src="${esc(thumbUrl(it))}" alt="" loading="lazy">` : ''}</div>`;
  }).join('');
  const chips = (type, list) => (list || []).map((v, idx) => {
    const on = g.picked[type].includes(idx);
    return `<span class="gchip ${on ? '' : 'off'}" data-t="${type}" data-i="${idx}" data-g="${i}">${esc(v)}</span>`;
  }).join('');
  return `<div class="gcard">
    <div class="gpv">${cells}</div>
    <div class="gb">
      <div class="gk">DIRECTION 0${i + 1}${g.previewQuery ? ' · ' + esc(g.previewQuery).slice(0, 34) : ''}</div>
      <h3>${esc(g.name)}</h3>
      <p class="gtag">${esc(g.tagline)}</p>
      <p class="gtheme">${esc(g.theme)}</p>
      <div class="gchips">${chips('costume', g.costume)}${chips('style', g.style)}${chips('props', g.props)}</div>
      <p class="hint" style="margin:0">${esc(g.time || '')}${g.location ? ' · ' + esc(g.location) : ''}</p>
      <div class="gpal">${(g.palette || []).slice(0, 5).map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</div>
      <div class="gfoot"><button class="btn primary" data-pick="${i}">用这个方向生成 20 张</button></div>
    </div>
  </div>`;
}

function bindStep2() {
  const el = root();
  el.querySelectorAll('.gchip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const gi = Number(chip.dataset.g);
      const type = chip.dataset.t;
      const idx = Number(chip.dataset.i);
      const g = W.groups[gi];
      const arr = g.picked[type];
      const at = arr.indexOf(idx);
      if (at >= 0) arr.splice(at, 1);
      else arr.push(idx);
      chip.classList.toggle('off');
      const btn = chip.closest('.gb').querySelector('[data-pick]');
      const count = g.picked.costume.length + g.picked.style.length + g.picked.props.length;
      btn.disabled = count === 0;
    });
  });
  el.querySelectorAll('[data-pick]').forEach((b) => {
    b.addEventListener('click', () => generate(Number(b.dataset.pick)));
  });
  const back = document.getElementById('wzBack');
  if (back) back.addEventListener('click', () => { W.step = 1; W.error = ''; render(); });
  const again = document.getElementById('wzAgain');
  if (again) again.addEventListener('click', () => { W.step = 1; W.error = ''; render(); startGroups(); });
}

/* -------------------------------------------------------------- step 3 */

function step3() {
  return `${steps(3)}
  <h2 class="wz-h">正在写策划</h2>
  <p class="wz-sub">${W.mode === 'refs'
    ? `逐张识别你上传的 ${W.refs.length} 张图 → 写成 ${W.refs.length} 个镜头。图片多时需要一两分钟，请不要关闭页面。`
    : '检索参考图 → 识别每张的属性 → 写成 20 个镜头。通常需要 30–90 秒，请不要关闭页面。'}</p>
  <div class="prog" id="wzProg">
    ${W.progress.map((p) => `<div class="prow ${p.status}" data-k="${p.key}">
      <i class="pdot"></i><span class="pname">${p.label}</span><span class="pval">${esc(p.detail || '')}</span>
    </div>`).join('')}
  </div>
  ${errorBox()}
  ${W.error ? `<div class="wz-actions"><button class="btn" id="wzBack2">← 换一个方向</button></div>` : ''}`;
}

function setProg(key, status, detail) {
  if (!W || !W.progress) return;
  const p = W.progress.find((x) => x.key === key);
  if (p) { p.status = status; p.detail = detail || ''; }
  const row = document.querySelector(`#wzProg .prow[data-k="${key}"]`);
  if (row) {
    row.className = 'prow ' + status;
    row.querySelector('.pval').textContent = detail || '';
  }
}

/* -------------------------------------------------------------- step 4 */

function step4() {
  const plan = W.plan || state.plan;
  return `${steps(3)}
  <div class="wz-result">
    <div class="gk">DONE</div>
    <h2 class="big">已经写好 ${plan.shots.length} 个镜头</h2>
    <p>${esc(plan.theme)}${plan.location ? ' · ' + esc(plan.location) : ''}<br>可以直接改文字、换图，或继续添加自己的照片。</p>
    <div class="wz-actions" style="justify-content:center">
      <button class="btn primary lg" id="wzView">查看策划案</button>
      <button class="btn lg" id="wzExport">导出长图</button>
    </div>
  </div>`;
}

function bindStep4() {
  const v = document.getElementById('wzView');
  if (v) v.addEventListener('click', () => closeWizard());
  const e = document.getElementById('wzExport');
  if (e) e.addEventListener('click', () => {
    closeWizard();
    setTimeout(() => document.dispatchEvent(new CustomEvent('sp:export')), 220);
  });
}

/* ---------------------------------------------------------- 生成流程 */

async function startGroups() {
  if (!hasCred()) {
    W.error = '还没有配置模型接口。点下面的「打开设置」填入接口地址、Key 和模型名。';
    render();
    return;
  }
  if (!W.theme.trim() && !W.refs.length && !W.extra.style.length && !W.extra.costume.length) {
    W.error = '至少给一个主题、一张参考图，或一条风格/服装信息。';
    render();
    return;
  }
  W.busy = true;
  W.error = '';
  render();
  try {
    const groups = await generateGroups(Object.assign({ theme: W.theme.trim() }, W.extra), W.refs);
    if (!W) return;
    groups.forEach((g) => {
      g.picked = {
        costume: g.costume.map((_, i) => i),
        style: g.style.map((_, i) => i),
        props: g.props.map((_, i) => i),
      };
      g.preview = [];
    });
    W.groups = groups;
    W.step = 2;
    W.busy = false;
    render();
    // 每组抓 4 张预览（并行，失败不影响流程）
    await Promise.all(groups.map(async (g, i) => {
      const q = previewQueries(g)[0];
      try {
        const items = await searchImages(q, 8);
        g.preview = items.slice(0, 4);
        g.previewQuery = q;
      } catch (e) {
        g.preview = [];
      }
      const card = document.querySelectorAll('.gcard')[i];
      if (card && g.preview.length) {
        const cells = card.querySelectorAll('.gpv div');
        g.preview.forEach((it, j) => {
          if (cells[j]) cells[j].innerHTML = `<img src="${esc(thumbUrl(it))}" alt="" loading="lazy">`;
        });
      }
    }));
  } catch (e) {
    W.busy = false;
    W.error = e.message;
    W.step = 1;
    render();
  }
}

async function analyzeBatch(items, group, onTick) {
  const out = new Array(items.length).fill(null);
  let done = 0;
  let fail = 0;
  let abort = false;
  const queue = items.map((_, i) => i);
  const worker = async () => {
    while (queue.length && !abort) {
      const i = queue.shift();
      try {
        out[i] = await analyzeShot(items[i], group);
      } catch (e) {
        fail += 1;
        if (/vision|image|multimodal|content.*type|invalid.*image/i.test(e.message || '')) abort = true;
      }
      done += 1;
      onTick(done, fail);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  return out;
}

async function generateFromRefs() {
  if (!W) return;
  const refs = W.refs.slice();
  if (!refs.length) { toast('先上传参考图', 'warn'); return; }
  if (!hasCred()) {
    W.error = '还没有配置模型接口。点下面的「打开设置」填入接口地址、Key 和模型名。';
    render();
    return;
  }
  if (!hasVision()) {
    W.error = '接口缺少可用的模型名。请在设置里填写模型（视觉模型留空时会沿用文本模型）。';
    render();
    return;
  }

  W.mode = 'refs';
  W.step = 3;
  W.error = '';
  W.busy = true;
  W.progress = [
    { key: 'analyze', label: '逐张识别上传的图片', status: 'wait', detail: '' },
    { key: 'write', label: '撰写分镜与注释', status: 'wait', detail: '' },
  ];
  render();

  try {
    const items = refs.map((u, i) => ({ url: u, thumb: u, query: `上传图 ${i + 1}` }));
    setProg('analyze', 'run', `0 / ${items.length}`);
    const analyses = await analyzeBatch(items, { theme: W.theme }, (done, fail) => {
      setProg('analyze', 'run', `${done} / ${items.length}${fail ? ` · 失败 ${fail}` : ''}`);
    });
    const ok = analyses.filter(Boolean).length;
    if (!ok) throw new Error('图片识别全部失败，请检查视觉模型是否可用');
    setProg('analyze', 'done', `${ok} / ${items.length} 已识别`);

    setProg('write', 'run', '撰写分镜中…');
    const group = {
      theme: W.theme.trim(),
      concept: '',
      costume: W.extra.costume,
      style: W.extra.style,
      props: W.extra.props,
      time: W.extra.time,
      location: W.extra.location,
      keywords: [],
    };
    let result = null;
    try {
      result = await composePlan({ group, shots: items, analyses, freeform: true });
    } catch (e) {
      console.warn('compose failed', e);
    }
    if (!result) {
      result = {
        theme: group.theme,
        costume: group.costume,
        style: group.style,
        props: group.props,
        time: group.time,
        location: group.location,
        shots: items.map((it, i) => Object.assign({ i: i + 1 }, analyses[i] || {})),
      };
    }
    setProg('write', 'done', '完成');

    const plan = normalizePlan({
      id: uid('p'),
      theme: result.theme || group.theme || '未命名拍摄',
      concept: result.concept || '',
      costume: (Array.isArray(result.costume) && result.costume.length ? result.costume : group.costume),
      style: (Array.isArray(result.style) && result.style.length ? result.style : group.style),
      props: (Array.isArray(result.props) && result.props.length ? result.props : group.props),
      time: result.time || group.time || '',
      location: result.location || group.location || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      shots: shotsFrom(items, result, analyses, group.props),
    });

    // 上传的原图落到 IndexedDB，方案里只留引用，避免撑爆 localStorage
    for (const s of plan.shots) {
      if (!s.url || !s.url.startsWith('data:')) continue;
      try {
        const id = uid('img');
        await putAsset(id, s.url);
        s._src = s.url;
        s.url = 'asset:' + id;
        s.thumb = '';
      } catch (e) {
        console.warn('保存图片失败', e);
      }
    }

    if (!W) { applyGeneratedPlan(plan); return; }
    W.plan = plan;
    W.step = 4;
    W.busy = false;
    applyGeneratedPlan(plan);
    render();
    toast(`已按上传的 ${plan.shots.length} 张图写好策划`);
  } catch (e) {
    if (!W) return;
    W.error = e.message || '生成失败';
    W.busy = false;
    render();
    const back = document.getElementById('wzBack2');
    if (back) back.addEventListener('click', () => { W.step = 1; W.error = ''; render(); });
  }
}

async function generate(gi) {
  const g = W.groups[gi];
  const picked = {
    costume: g.costume.filter((_, i) => g.picked.costume.includes(i)),
    style: g.style.filter((_, i) => g.picked.style.includes(i)),
    props: g.props.filter((_, i) => g.picked.props.includes(i)),
  };
  W.selected = gi;
  W.mode = 'directions';
  W.step = 3;
  W.error = '';
  W.busy = true;
  W.progress = [
    { key: 'search', label: '检索参考图（目标 20+ 张）', status: 'wait', detail: '' },
    { key: 'analyze', label: '视觉识别图片属性', status: 'wait', detail: '' },
    { key: 'write', label: '撰写分镜与注释', status: 'wait', detail: '' },
  ];
  render();

  const group = Object.assign({}, g, picked, { keywords: g.keywords || [] });

  try {
    setProg('search', 'run', '0 / 20');
    const queries = buildQueries(group, 24);
    let items = await collectImages(queries, 20, (n) => setProg('search', 'run', `${n} / 20`));
    if (items.length < 20) {
      const extra = await collectImages(
        [{ q: (g.keywords && g.keywords[0]) || g.theme, n: 20 }, { q: g.theme, n: 12 }],
        20 - items.length
      );
      const seen = new Set(items.map((x) => x.url));
      for (const it of extra) if (!seen.has(it.url)) { items.push(it); seen.add(it.url); }
    }
    if (!items.length) throw new Error('没有检索到参考图。请检查网络，或在设置里换一个图源。');
    if (!W) return;
    setProg('search', 'done', `${items.length} 张`);
    if (items.length < 20) toast(`只找到 ${items.length} 张参考图，先按现有图片生成`, 'warn');

    let analyses = null;
    if (autoVision() && state.settings.visionCheck) {
      setProg('analyze', 'run', `0 / ${items.length}`);
      analyses = await analyzeBatch(items, group, (done, fail) => {
        setProg('analyze', 'run', `${done} / ${items.length}${fail ? ` · 失败 ${fail}` : ''}`);
      });
      const ok = analyses.filter(Boolean).length;
      if (ok) setProg('analyze', 'done', `${ok} 张已识别`);
      else setProg('analyze', 'err', '识别失败，改用模型预设');
    } else {
      setProg('analyze', 'skip', autoVision() ? '已关闭视觉核对' : '用文本模型预设，未自动读图');
    }

    setProg('write', 'run', '生成分镜中…');
    let result = null;
    try {
      result = await composePlan({ group, shots: items, analyses });
    } catch (e) {
      console.warn('compose failed', e);
      if (W) W.error = '';
    }
    if (!result) {
      result = {
        theme: g.theme,
        concept: g.concept,
        costume: picked.costume,
        style: picked.style,
        props: picked.props,
        time: g.time,
        location: g.location,
        shots: items.map((it, i) => Object.assign({ i: i + 1 }, (analyses && analyses[i]) || {})),
      };
    }
    setProg('write', 'done', '完成');

    const plan = normalizePlan({
      id: uid('p'),
      theme: result.theme || g.theme || '',
      concept: result.concept || g.concept || '',
      costume: (Array.isArray(result.costume) && result.costume.length ? result.costume : picked.costume),
      style: (Array.isArray(result.style) && result.style.length ? result.style : picked.style),
      props: (Array.isArray(result.props) && result.props.length ? result.props : picked.props),
      time: result.time || g.time || '',
      location: result.location || g.location || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      shots: shotsFrom(items, result, analyses, picked.props),
    });

    if (!W) { applyGeneratedPlan(plan); return; }
    W.plan = plan;
    W.step = 4;
    W.busy = false;
    applyGeneratedPlan(plan);
    render();
    toast('策划已生成，可继续修改');
  } catch (e) {
    if (!W) return;
    W.error = e.message || '生成失败';
    W.busy = false;
    render();
    const back = document.getElementById('wzBack2');
    if (back) back.addEventListener('click', () => { W.step = W.mode === 'refs' ? 1 : 2; W.error = ''; render(); });
  }
}
