import { state, esc, uid, openModal, toast, persistCreds, persistSettings } from './core.js';
import { activeCred, testConnection, testVision } from './ai.js';

const PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', visionModel: 'deepseek-flash' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', visionModel: 'qwen-vl-max' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', visionModel: 'glm-4v-plus' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', visionModel: 'gpt-4o-mini' },
];

function blankCred() {
  return { id: '', name: '', baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-flash', visionModel: 'deepseek-flash', visionBaseUrl: '', visionApiKey: '' };
}

export function openSettings(tab) {
  let editing = activeCred() ? Object.assign(blankCred(), activeCred()) : blankCred();
  let editingId = editing.id || '';

  const render = () => {
    const list = state.creds.list || [];
    const s = state.settings;
    const html = `
      <div class="modal narrow">
        <div class="modal-head">
          <div><div class="ed-kicker">SETTINGS</div><h3>模型与图源</h3></div>
          <button class="x" data-close>×</button>
        </div>
        <div class="form">
          <div class="form-sec">
            <h4>模型接口 · 已保存 ${list.length}</h4>
            <div class="cred-list">
              ${list.length ? list.map((c) => `
                <div class="cred ${c.id === editingId ? 'on' : ''}" data-id="${c.id}">
                  <i class="dot"></i>
                  <span class="cname">${esc(c.name || c.model || '未命名')}</span>
                  <span class="curl">${esc((c.baseUrl || '').replace(/^https?:\/\//, ''))}</span>
                  <button class="cact" data-del="${c.id}">删除</button>
                </div>`).join('') : `<p class="hint" style="margin:0">还没有保存的接口。填入下面的信息后点「保存并使用」。</p>`}
            </div>
            <div class="presets">
              ${PRESETS.map((p, i) => `<button type="button" class="preset" data-preset="${i}">${p.name}</button>`).join('')}
              <button type="button" class="preset" data-new>＋ 新建接口</button>
            </div>

            <div class="field-row">
              <div><label>名称</label><input type="text" id="sName" placeholder="例：DeepSeek 官方" value="${esc(editing.name || '')}"></div>
              <div><label>接口地址 baseUrl</label><input type="text" id="sBase" placeholder="https://api.deepseek.com" value="${esc(editing.baseUrl || '')}"></div>
            </div>
            <div style="margin-top:12px"><label>API Key</label><input type="password" id="sKey" placeholder="sk-..." value="${esc(editing.apiKey || '')}"></div>
            <div class="field-row" style="margin-top:12px">
              <div><label>文本模型</label><input type="text" id="sModel" placeholder="deepseek-flash" value="${esc(editing.model || '')}"></div>
              <div>
                <label>视觉模型（读图）</label>
                <div style="display:flex;gap:8px;align-items:center">
                  <input type="text" id="sVision" placeholder="deepseek-flash" value="${esc(editing.visionModel || '')}">
                  <button type="button" class="link" id="sVisionSame" style="white-space:nowrap">同文本模型</button>
                </div>
              </div>
            </div>
            <p class="hint">视觉模型留空时会沿用文本模型。DeepSeek 用 <code>deepseek-flash</code>（<code>deepseek-v4-pro</code> 不支持图片）；如果文本模型本身不支持读图，识别会失败，填一个多模态模型即可。视觉模型在另一个服务上时，展开下面填写独立地址。</p>
            <details class="more">
              <summary>视觉模型使用独立接口</summary>
              <div class="more-grid">
                <div><label>视觉接口 baseUrl</label><input type="text" id="sVBase" placeholder="留空则沿用上面的地址" value="${esc(editing.visionBaseUrl || '')}"></div>
                <div><label>视觉接口 API Key</label><input type="password" id="sVKey" placeholder="留空则沿用上面的 Key" value="${esc(editing.visionApiKey || '')}"></div>
              </div>
            </details>
            <div class="wz-actions" style="margin-top:16px">
              <button class="btn primary" id="sSave">保存并使用</button>
              <button class="btn" id="sTest">测试连接</button>
              <button class="btn" id="sTestVision">测试读图</button>
              <span class="hint" id="sTestOut" style="margin:0"></span>
            </div>
            <p class="hint">凭据只保存在这台设备的浏览器里（localStorage），不会上传到任何第三方；请求经本机服务转发到你所填的接口。</p>
          </div>

          <div class="form-sec">
            <h4>参考图图源</h4>
            <div class="field-row">
              <div>
                <label>检索服务</label>
                <select id="pProvider">
                  <option value="auto" ${s.provider === 'auto' ? 'selected' : ''}>自动（Bing → Unsplash → Openverse）</option>
                  <option value="bing" ${s.provider === 'bing' ? 'selected' : ''}>Bing 图片（免密钥）</option>
                  <option value="unsplash" ${s.provider === 'unsplash' ? 'selected' : ''}>Unsplash（免密钥）</option>
                  <option value="openverse" ${s.provider === 'openverse' ? 'selected' : ''}>Openverse（免密钥）</option>
                  <option value="custom" ${s.provider === 'custom' ? 'selected' : ''}>自定义 JSON 接口</option>
                </select>
              </div>
              <div>
                <label>自定义接口模板</label>
                <input type="text" id="pCustom" placeholder="https://.../search?q={q}&n={n}" value="${esc(s.customTpl || '')}">
              </div>
            </div>
            <p class="hint">自定义接口需返回 JSON 数组或 <code>results / data / items / hits</code> 字段，每项包含 <code>url</code>（或 image / src）与可选的 <code>thumb</code>、<code>title</code>。{q} 会被替换为检索词，{n} 为数量。</p>
            <p class="hint">小红书有登录与签名校验，服务端做不了关键词检索；要取小红书的图，请用分镜工具栏「＋ 添加图片 → 从小红书链接导入」，粘贴笔记链接按篇解析。</p>
          </div>

          <div class="form-sec">
            <h4>生成偏好</h4>
            <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-2);letter-spacing:0">
              <input type="checkbox" id="pVision" ${s.visionCheck ? 'checked' : ''} style="width:auto">
              自动生成时，用视觉模型逐张核对图片属性（更准，但更慢）
            </label>
            <p class="hint">关闭后，属性由模型按分镜设计预设，仍可在每张图上点「识别」单独校对。</p>
          </div>
        </div>
        <div class="modal-foot">
          <span class="hint" style="margin:0">修改会自动保存</span>
          <div class="grow"></div>
          <button class="btn" data-close>关闭</button>
        </div>
      </div>`;
    const modal = openModal(html);
    bind(modal);
    return modal;
  };

  const readForm = (el) => ({
    id: editingId,
    name: el.querySelector('#sName').value.trim(),
    baseUrl: el.querySelector('#sBase').value.trim(),
    apiKey: el.querySelector('#sKey').value.trim(),
    model: el.querySelector('#sModel').value.trim(),
    visionModel: el.querySelector('#sVision').value.trim(),
    visionBaseUrl: el.querySelector('#sVBase').value.trim(),
    visionApiKey: el.querySelector('#sVKey').value.trim(),
  });

  const bind = (modal) => {
    const el = modal.el;

    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => {
      state.settings.provider = el.querySelector('#pProvider').value;
      state.settings.customTpl = el.querySelector('#pCustom').value.trim();
      state.settings.visionCheck = el.querySelector('#pVision').checked;
      persistSettings();
      modal.close();
    }));

    el.querySelectorAll('.cred').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]')) return;
        const c = state.creds.list.find((x) => x.id === row.dataset.id);
        if (!c) return;
        editingId = c.id;
        editing = Object.assign(blankCred(), c);
        state.creds.active = c.id;
        persistCreds();
        modal.close();
        openSettings();
      });
    });

    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = b.dataset.del;
      state.creds.list = state.creds.list.filter((c) => c.id !== id);
      if (state.creds.active === id) state.creds.active = (state.creds.list[0] || {}).id || '';
      persistCreds();
      if (editingId === id) { editingId = ''; editing = blankCred(); }
      modal.close();
      openSettings();
      toast('已删除接口');
    }));

    el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const p = PRESETS[Number(b.dataset.preset)];
      if (!p) return;
      el.querySelector('#sName').value = p.name;
      el.querySelector('#sBase').value = p.baseUrl;
      el.querySelector('#sModel').value = p.model;
      el.querySelector('#sVision').value = p.visionModel;
    }));

    const newBtn = el.querySelector('[data-new]');
    if (newBtn) newBtn.addEventListener('click', () => {
      editingId = '';
      editing = blankCred();
      modal.close();
      openSettings();
    });

    const sameBtn = el.querySelector('#sVisionSame');
    if (sameBtn) sameBtn.addEventListener('click', () => {
      el.querySelector('#sVision').value = el.querySelector('#sModel').value.trim();
    });

    el.querySelector('#sSave').addEventListener('click', () => {
      const f = readForm(el);
      if (!f.baseUrl || !f.apiKey) { toast('接口地址和 API Key 都要填', 'warn'); return; }
      if (!/^https?:\/\//.test(f.baseUrl)) { toast('接口地址要以 http(s):// 开头', 'warn'); return; }
      if (!f.model) { toast('请填写文本模型名', 'warn'); return; }
      let id = editingId;
      if (!id) {
        id = uid('c');
        state.creds.list.push(Object.assign({}, f, { id }));
      } else {
        const i = state.creds.list.findIndex((c) => c.id === id);
        if (i >= 0) state.creds.list[i] = Object.assign({}, f, { id });
        else state.creds.list.push(Object.assign({}, f, { id }));
      }
      state.creds.active = id;
      persistCreds();
      toast('已保存，当前使用：' + (f.name || f.model));
      modal.close();
      openSettings();
    });

    el.querySelector('#sTest').addEventListener('click', async () => {
      const out = el.querySelector('#sTestOut');
      const f = readForm(el);
      if (!f.baseUrl || !f.apiKey) { out.textContent = '先填地址和 Key'; return; }
      out.textContent = '测试中…';
      try {
        const r = await testConnection(f);
        out.textContent = '连接正常：' + r;
        out.style.color = 'var(--green)';
      } catch (e) {
        out.textContent = e.message;
        out.style.color = 'var(--accent-ink)';
      }
    });

    el.querySelector('#sTestVision').addEventListener('click', async () => {
      const out = el.querySelector('#sTestOut');
      const f = readForm(el);
      if (!f.baseUrl || !f.apiKey) { out.textContent = '先填地址和 Key'; return; }
      out.textContent = '读图中…';
      out.style.color = '';
      try {
        const r = await testVision(f);
        out.textContent = '读图正常：' + r;
        out.style.color = 'var(--green)';
      } catch (e) {
        out.textContent = '读图失败：' + e.message;
        out.style.color = 'var(--accent-ink)';
      }
    });

    el.querySelector('#pProvider').addEventListener('change', (e) => {
      state.settings.provider = e.target.value;
      persistSettings();
    });
    el.querySelector('#pVision').addEventListener('change', (e) => {
      state.settings.visionCheck = e.target.checked;
      persistSettings();
    });
    el.querySelector('#pCustom').addEventListener('change', (e) => {
      state.settings.customTpl = e.target.value.trim();
      persistSettings();
    });
  };

  render();
}
