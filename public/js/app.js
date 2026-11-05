import {
  state, bootData, hydrateAssets, emptyPlan, persist, openModal, confirmDialog, toast, esc,
} from './core.js';
import { initView, renderAll, applyGeneratedPlan } from './view.js';
import { openWizard } from './wizard.js';
import { exportLongImage } from './exporter.js';
import { openSettings } from './settings.js';
import { demoPlan } from './demo.js';

function bindTop() {
  document.getElementById('brand').addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('btnWizard').addEventListener('click', openWizard);
  document.getElementById('btnExport').addEventListener('click', exportLongImage);
  document.getElementById('btnSettings').addEventListener('click', () => openSettings());
  document.getElementById('btnHelp').addEventListener('click', helpModal);
  document.getElementById('btnNew').addEventListener('click', newPlan);
  document.addEventListener('sp:wizard', openWizard);
  document.addEventListener('sp:export', exportLongImage);
}

async function newPlan() {
  const ok = await confirmDialog(
    `新建会清空当前策划「${esc(state.plan.theme || '未命名')}」，包括 ${state.plan.shots.length} 张图片和全部注释。<br><br>建议先导出长图留档。`,
    '新建空白策划'
  );
  if (!ok) return;
  state.plan = emptyPlan();
  state.ui.dim = null;
  state.ui.sel = [];
  persist(true);
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('已新建，可以先添加图片，或让 AI 写一版');
}

function helpModal() {
  const modal = openModal(`
    <div class="modal narrow">
      <div class="modal-head">
        <div><div class="ed-kicker">HOW IT WORKS</div><h3>使用说明</h3></div>
        <button class="x" data-close>×</button>
      </div>
      <div class="help-body">
        <h4>1 · 开篇</h4>
        <p>主题、概念、服装期望、风格形式、道具、时间、地点都可以直接点开改。带虚线框的「＋」是标签，回车确认，点 × 删除。</p>

        <h4>2 · 分镜编排</h4>
        <p>工具栏点「道具 / 景别 / 方向 / 角度 / 焦距 / 构图 / 光位」中的任意一项，图片就会按这一维度分组排序；再点下方的具体值可以筛选。</p>
        <ul>
          <li>「道具」多选表示<strong>同时出现</strong>（用来找组合）；「构图」多选表示<strong>任选其一</strong>。「道具」分组会把多道具的图按具体组合拆开，组名直接写「道具1 ＋ 道具2」。</li>
          <li>筛选或分组之后，每张图下方仍然显示它的全部属性，方便对照。</li>
          <li>光位里「柔光」同时收容了没判断出来的图片。</li>
        </ul>

        <h4>3 · 改动与插图</h4>
        <p>鼠标移到图片上会出现「← → 识别 编辑」；直接点图片也能打开编辑面板。添加图片时，如果配置了视觉模型，会自动识别属性并打开面板让你确认。</p>

        <h4>4 · AI 自动策划</h4>
        <p>给一个主题或几张参考图 → AI 拆出 3 个视觉方向（每组带 4 张预览图）→ 点掉不要的服装/风格/道具 → 选一个方向，后台会检索 20+ 张参考图、逐张识别属性并写成 20 个镜头。</p>
        <p>参考图张数不限。如果手上已经有合适的图，可以点「跳过方向 · 直接用 N 张图写策划」：逐张识别你上传的图，直接写成同样数量的镜头，主题/服装/风格/道具/时间/地点由 AI 从画面里推断（你填了就以你为准）。这条路径需要视觉模型。</p>

        <h4>5 · 模型设置</h4>
        <p>支持任何 OpenAI 兼容接口。DeepSeek 直接用 <code>deepseek-flash</code>：写方向、写分镜、读图判断景别/光位都由它完成（<code>deepseek-v4-pro</code> 不支持图片）。也可以换成 <code>qwen-vl-max</code>、<code>glm-4v-plus</code>、<code>gpt-4o-mini</code>。视觉模型留空时会沿用文本模型；不确定能不能读图，点设置里的「测试读图」验证。凭据只保存在本机浏览器。</p>

        <h4>6 · 参考图图源</h4>
        <p>默认用免密钥的 Bing 图片检索；也可以在设置里换 Unsplash / Openverse，或填自己的 JSON 检索接口。图片会经本机服务代理，避免防盗链与跨域问题。</p>

        <h4>7 · 从小红书取图</h4>
        <p>小红书没有开放搜索接口，所以不做关键词搜索，而是<strong>按笔记链接取图</strong>：在 App 里点分享 → 复制链接，粘到「添加图片 → 从小红书链接导入」，一次最多 6 篇。会自动解析该笔记的全部公开配图，勾选后导入；图片会下载到本地，不依赖原链接，之后可以照常 AI 识别属性。仅供个人创作参考，请勿商用或批量抓取。</p>

        <h4>8 · 长图导出</h4>
        <p>按当前的分组与筛选导出 1240px 宽的 PNG，含开篇信息、镜头注释与全部属性标签。</p>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:26px;padding-top:18px;border-top:1px solid var(--line-2)">
          <button class="btn" id="hDemo">载入示例方案</button>
          <button class="btn danger" id="hClear">清空本地数据</button>
          <div class="grow"></div>
          <button class="btn primary" data-close>知道了</button>
        </div>
      </div>
    </div>`, { onClose: () => {} });

  modal.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => modal.close()));

  modal.el.querySelector('#hDemo').addEventListener('click', async () => {
    const ok = await confirmDialog('载入示例会替换当前策划，确定吗？', '载入示例');
    if (!ok) return;
    applyGeneratedPlan(demoPlan());
    modal.close();
    toast('已载入示例方案');
  });

  modal.el.querySelector('#hClear').addEventListener('click', async () => {
    const ok = await confirmDialog('会删除本机保存的策划、图片与接口配置，且无法恢复。确定吗？', '全部清空');
    if (!ok) return;
    window.__spNoSave = true;
    try {
      localStorage.clear();
      const dbs = await indexedDB.databases();
      await Promise.all((dbs || []).map((d) => new Promise((res) => {
        const req = indexedDB.deleteDatabase(d.name);
        req.onsuccess = req.onerror = req.onblocked = () => res();
      })));
    } catch (e) { /* ignore */ }
    location.reload();
  });
}

async function boot() {
  if (location.protocol === 'file:') {
    document.body.insertAdjacentHTML('afterbegin', `<div style="position:sticky;top:0;z-index:999;background:#8b3f27;color:#fbf9f4;font-size:12.5px;line-height:1.7;padding:10px 20px;text-align:center">
      当前是本地文件模式，AI 与图源接口不可用。请双击项目里的 <b>start.bat</b> 启动服务，再访问 <b>http://localhost:4173</b>。
    </div>`);
  }
  bootData();
  try { await hydrateAssets(); } catch (e) { console.warn(e); }
  initView();
  renderAll();
  bindTop();
  window.addEventListener('beforeunload', () => {
    if (!window.__spNoSave) persist(true);
  });
  if (!state.plan.shots.length && !localStorage.getItem('sp.plan.v2')) {
    setTimeout(() => toast('这是空白策划，可以点右上角「AI 自动策划」'), 600);
  }
}

boot();
