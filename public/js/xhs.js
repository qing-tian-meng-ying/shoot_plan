import { esc, openModal, toast, toDataUrl } from './core.js';

function proxy(u) {
  if (!u) return '';
  if (u.startsWith('data:') || u.startsWith('/')) return u;
  return '/api/img?u=' + encodeURIComponent(u);
}

async function pool(list, limit, fn) {
  const queue = list.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}


function parseLinks(text) {
  const raw = String(text || '');
  const re = /(?:https?:\/\/)?(?:www\.)?(?:xiaohongshu\.com\/(?:explore|discovery\/item)\/[0-9a-zA-Z]+|xhslink\.com\/[A-Za-z0-9/_-]+)/g;
  const out = [];
  let m;
  while ((m = re.exec(raw))) {
    let u = m[0];
    if (!/^https?:\/\//.test(u)) u = 'https://' + u;
    out.push(u);
  }
  return Array.from(new Set(out)).slice(0, 6);
}

function noteIdOf(u) {
  const m = String(u).match(/xiaohongshu\.com\/(?:explore|discovery\/item)\/([0-9a-zA-Z]+)/);
  return m ? m[1] : '';
}

/**
 * 从小红书笔记链接导入图片
 * @param {{maxSize?:number, onDone?:(items:Array<{dataUrl:string,title:string,noteUrl:string}>)=>void}} opts
 */
export function openXhsImport(opts = {}) {
  const maxSize = opts.maxSize || 1600;
  const onDone = opts.onDone || (() => {});

  let notes = [];
  let failures = [];
  let busy = false;
  let alive = true;

  const modal = openModal(`
    <div class="modal narrow" style="width:min(860px,100%)">
      <div class="modal-head">
        <div><div class="ed-kicker">XIAOHONGSHU</div><h3>从小红书导入图片</h3></div>
        <button class="x" data-close>×</button>
      </div>
      <div class="xhs-body">
        <p class="hint" style="margin:0 0 10px">
          小红书没有开放搜索接口，这里按「笔记链接」取图：在 App 里点分享 → 复制链接，粘贴进来即可，
          直接粘整段分享文字也行。链接形如 <code>https://www.xiaohongshu.com/explore/</code> + 24 位 ID，或 <code>http://xhslink.com/…</code>。
          一次最多 6 条，只取该笔记的公开配图，供个人创作参考，请勿商用或批量抓取。
        </p>
        <textarea id="xhsLinks" class="theme-input" style="min-height:88px;font-size:13px;line-height:1.7"
          placeholder="https://www.xiaohongshu.com/explore/6a1b2c3d00000000xxxxxxxx&#10;http://xhslink.com/a/xxxxxxx&#10;（也可以直接粘贴 App 分享出来的整段文字）"></textarea>
        <div class="wz-actions" style="margin-top:12px">
          <button class="btn primary" id="xhsParse">解析图片</button>
          <span class="hint" id="xhsStatus" style="margin:0"></span>
        </div>
        <div id="xhsError" class="wz-error hide"></div>
        <div id="xhsResults" class="xhs-results"></div>
      </div>
      <div class="modal-foot">
        <span class="hint" id="xhsCount" style="margin:0"></span>
        <div class="grow"></div>
        <button class="btn" data-close>取消</button>
        <button class="btn primary" id="xhsImport" disabled>导入</button>
      </div>
    </div>`, {
    onClose: () => { alive = false; },
  });

  const el = modal.el;
  const ta = el.querySelector('#xhsLinks');
  const status = el.querySelector('#xhsStatus');
  const results = el.querySelector('#xhsResults');
  const countEl = el.querySelector('#xhsCount');
  const importBtn = el.querySelector('#xhsImport');
  const errorBox = el.querySelector('#xhsError');

  const setStatus = (t) => { status.textContent = t; };

  const picked = () => {
    const out = [];
    notes.forEach((n) => n.images.forEach((im) => {
      if (im.sel) out.push({ url: im.url, title: n.title, noteUrl: n.noteUrl });
    }));
    return out;
  };

  const refreshCount = () => {
    const n = picked().length;
    countEl.textContent = n ? `已选 ${n} 张` : '';
    importBtn.disabled = !n || busy;
    importBtn.textContent = n ? `导入 ${n} 张` : '导入';
  };

  const render = () => {
    results.innerHTML = notes.map((n, ni) => `
      <div class="xnote">
        <div class="xnote-head">
          <span class="xtitle">${esc(n.title)}</span>
          <a class="xlink" href="${esc(n.noteUrl)}" target="_blank" rel="noreferrer">查看原笔记 ↗</a>
        </div>
        <div class="xgrid">
          ${n.images.map((im, ii) => `
            <label class="xpick ${im.sel ? 'on' : ''}" data-n="${ni}" data-i="${ii}">
              <img src="${esc(proxy(im.thumb || im.url))}" alt="" loading="lazy">
              <input type="checkbox" ${im.sel ? 'checked' : ''}>
            </label>`).join('')}
        </div>
      </div>`).join('');

    results.querySelectorAll('.xpick').forEach((lab) => {
      lab.addEventListener('click', (e) => {
        e.preventDefault();
        const n = notes[Number(lab.dataset.n)];
        const im = n && n.images[Number(lab.dataset.i)];
        if (!im) return;
        im.sel = !im.sel;
        lab.classList.toggle('on', im.sel);
        const cb = lab.querySelector('input');
        if (cb) cb.checked = im.sel;
        refreshCount();
      });
    });
    refreshCount();
  };

  const renderErrors = () => {
    if (!failures.length) { errorBox.classList.add('hide'); return; }
    errorBox.classList.remove('hide');
    errorBox.innerHTML = '<b>这些链接没取到图</b>' + failures.map((f) => esc(f)).join('<br>');
  };

  el.querySelector('#xhsParse').addEventListener('click', async () => {
    if (busy) return;
    const links = parseLinks(ta.value);
    if (!links.length) {
      setStatus('');
      failures = ['没找到小红书链接。可以直接粘贴 App 里「分享 → 复制链接」出来的整段文字。'];
      renderErrors();
      return;
    }

    busy = true;
    notes = [];
    failures = [];
    results.innerHTML = '';
    errorBox.classList.add('hide');
    refreshCount();

    for (let i = 0; i < links.length; i++) {
      const nid = noteIdOf(links[i]);
      if (nid && !/^[0-9a-f]{24}$/i.test(nid)) {
        failures.push(`${links[i].replace(/^https?:\/\//, '').slice(0, 46)} — 笔记 ID 不完整：应为 24 位，这条只有 ${nid.length} 位。请在 App 里重新「分享 → 复制链接」。`);
        continue;
      }
      setStatus(`解析中 ${i + 1} / ${links.length}`);
      try {
        const r = await fetch('/api/xhs/note?url=' + encodeURIComponent(links[i]));
        const j = await r.json().catch(() => ({ error: '解析失败' }));
        if (!r.ok) throw new Error(j.error || '解析失败');
        if (!j.ok) throw new Error(j.error || '没有配图');
        notes.push({
          title: j.title || '小红书笔记',
          noteUrl: j.noteUrl || links[i],
          images: (j.images || []).map((x) => ({ url: x.url, thumb: x.thumb || x.url, sel: true })),
        });
        if (alive) render();
      } catch (e) {
        failures.push(links[i].replace(/^https?:\/\//, '').slice(0, 46) + ' — ' + e.message);
      }
      if (i < links.length - 1) await new Promise((r) => setTimeout(r, 320));
    }

    busy = false;
    if (!alive) return;
    renderErrors();
    const total = notes.reduce((a, n) => a + n.images.length, 0);
    setStatus(total ? `共取到 ${total} 张，勾选后导入` : '没有取到图片');
    refreshCount();
  });

  importBtn.addEventListener('click', async () => {
    if (busy) return;
    const list = picked();
    if (!list.length) return;
    busy = true;
    importBtn.disabled = true;

    const out = [];
    let done = 0;
    let fail = 0;
    await pool(list, 3, async (item) => {
      try {
        const dataUrl = await toDataUrl(proxy(item.url), maxSize, 0.86);
        out.push({ dataUrl, title: item.title, noteUrl: item.noteUrl });
      } catch (e) {
        fail += 1;
      }
      done += 1;
      if (alive) setStatus(`下载中 ${done} / ${list.length}`);
    });

    busy = false;
    if (!alive) return;
    if (!out.length) {
      setStatus('下载失败，可能是图片链接已过期，重新解析试试');
      refreshCount();
      return;
    }
    modal.close();
    onDone(out);
    toast(fail ? `已导入 ${out.length} 张，${fail} 张失败` : `已导入 ${out.length} 张`);
  });

  setTimeout(() => ta.focus(), 80);
  return modal;
}
