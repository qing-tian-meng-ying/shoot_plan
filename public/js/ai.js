import { state, OPTIONS, toDataUrl, shotSrc } from './core.js';

/* ------------------------------------------------------------ 凭据 */

export function activeCred() {
  const { list, active } = state.creds;
  if (!list || !list.length) return null;
  return list.find((c) => c.id === active) || list[0];
}

export function hasCred() {
  const c = activeCred();
  return !!(c && c.baseUrl && c.apiKey);
}

export function visionModelOf(c = activeCred()) {
  if (!c) return '';
  // 视觉模型留空时沿用文本模型：很多 OpenAI 兼容接口本身就是多模态的
  return c.visionModel || c.model || '';
}

export function hasVision() {
  const c = activeCred();
  return !!(c && c.baseUrl && c.apiKey && visionModelOf(c));
}

// 自动批量识别前的保守判断：只有明确配了视觉模型，或模型名看起来是多模态的，才自动跑
export function autoVision() {
  const c = activeCred();
  if (!hasVision()) return false;
  if (c.visionModel) return true;
  return /(deepseek-flash|gpt-4o|gpt-4\.1|gpt-5|o3|o4|qwen[^\s]*vl|glm-4v|gemini|claude-(3|4)|vision|llava|internvl)/i.test(c.model || '');
}

export function credLabel(c) {
  if (!c) return '未配置';
  return c.name || c.baseUrl || '未命名接口';
}

/* ------------------------------------------------------------ 调用 */

async function callLLM(messages, opts = {}) {
  const cred = opts.cred || activeCred();
  if (!cred) throw new Error('尚未配置模型接口，请先在设置里填写 API');
  const endpoint = opts.endpoint || {};
  const baseUrl = endpoint.baseUrl || cred.baseUrl;
  const apiKey = endpoint.apiKey || cred.apiKey;
  if (!baseUrl) throw new Error('模型接口地址为空');
  const body = {
    model: opts.model || cred.model || 'deepseek-flash',
    messages,
    temperature: opts.temperature == null ? 0.7 : opts.temperature,
    stream: false,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  // DeepSeek 默认开启思考模式；读图/连通性测试这类结构化短任务关掉更快
  if (opts.fast && /deepseek\.com/i.test(baseUrl)) body.thinking = { type: 'disabled' };
  if (opts.json !== false) body.response_format = { type: 'json_object' };

  const send = async () => {
    const r = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, body }),
    });
    const data = await r.json().catch(() => ({ error: '接口返回了非 JSON 内容' }));
    return { r, data };
  };

  let { r, data } = await send();
  const retryable = r.status === 400 || r.status === 422
    || /response_format|json_object|json mode|unsupported/i.test((data && data.error) || '');
  if (!r.ok && opts.json !== false && retryable) {
    delete body.response_format;
    ({ r, data } = await send());
  }
  if (!r.ok) throw new Error(data.error || ('模型调用失败（' + r.status + '）'));
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('模型没有返回内容');
  return content;
}

function parseJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (e) { /* continue */ }
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(t.slice(s, e + 1)); } catch (err) { /* continue */ }
  }
  const s2 = t.indexOf('[');
  const e2 = t.lastIndexOf(']');
  if (s2 >= 0 && e2 > s2) {
    try { return JSON.parse(t.slice(s2, e2 + 1)); } catch (err) { /* continue */ }
  }
  throw new Error('模型返回的内容不是合法 JSON');
}

function str(v, max = 200) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function arr(v, max = 6) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x, 60)).filter(Boolean).slice(0, max);
}

const DIM_RULES = `属性必须从下面枚举中选择，不得自造：
- 景别：${OPTIONS.shotSize.join(' / ')}
- 方向：${OPTIONS.direction.join(' / ')}
- 角度：${OPTIONS.angle.join(' / ')}
- 焦距：${OPTIONS.focal.join(' / ')}
- 构图：${OPTIONS.composition.join(' / ')}（可多选 1–2 个）
- 光位：${OPTIONS.light.join(' / ')}（无法判断时用「柔光」）`;

/* -------------------------------------------------- 生成视觉方向组 */

export async function generateGroups(input, refs = []) {
  const limited = (refs || []).slice(0, 3);
  const withVision = autoVision() && limited.length > 0;

  const system = `你是一位资深摄影指导与视觉策划（Art Director），长期为杂志与品牌拍摄人物专题。
你的任务：把客户模糊的拍摄想法，拆成 2–3 个差异明显、可直接执行的视觉方向。

硬性规则：
1. 客户已给出的信息（风格、服装、道具、时间、地点）必须全部用上，不得替换或忽略；缺失的信息由你补全，具体到能直接执行。
2. 道具必须是能带到现场的具体物件（3–6 件），禁止抽象词（如「氛围感」「情绪」）。
3. 风格形式要写影像质感：介质（胶片/数码）、色温、光线方向、后期倾向。
4. 每个方向给出 4–6 条英文检索词，用于找参考图：必须是「主体 + 场景 + 光线 + 风格」的画面化短语（例：woman by rainy cafe window, soft daylight, 35mm film），不要只写主题词。
5. 各方向必须在光线、色调、场景或情绪上明显不同，不要只换形容词。
6. 只输出 JSON，不要任何解释。`;

  const extra = [];
  if (input.style && input.style.length) extra.push('风格偏好：' + input.style.join('、'));
  if (input.costume && input.costume.length) extra.push('服装条件：' + input.costume.join('、'));
  if (input.props && input.props.length) extra.push('已有道具：' + input.props.join('、'));
  if (input.time) extra.push('时间限制：' + input.time);
  if (input.location) extra.push('地点限制：' + input.location);

  const text = `拍摄主题：${input.theme || '（客户没有明确主题，请根据参考图推断）'}
${extra.length ? extra.join('\n') : '客户没有提供其他补充信息。'}
${limited.length ? `客户提供了 ${limited.length} 张参考图（见附件），请先理解它们的色调、光线与场景，再发散方向。` : ''}

请输出 JSON：
{"groups":[{"name":"4–8 字方向名","tagline":"一句话说明它与其他方向的区别","theme":"完整主题，可带副标题","concept":"60–90 字，写清画面气质与叙事线索","costume":["3–5 项，具体到颜色与材质"],"style":["3–4 项，含介质/色温/光线/后期"],"props":["3–6 件具体道具"],"palette":["#RRGGBB","#RRGGBB","#RRGGBB"],"keywords":["4–6 条英文检索词"],"time":"建议时段与天气","location":"建议场景与机位"}]}`;

  const content = withVision
    ? [{ type: 'text', text }, ...limited.map((u) => ({ type: 'image_url', image_url: { url: u } }))]
    : text + (limited.length ? '\n（参考图已上传，但当前模型可能不支持读图，请仅依据文字信息推演。）' : '');

  let raw;
  try {
    raw = await callLLM(
      [{ role: 'system', content: system }, { role: 'user', content }],
      { temperature: 0.95, json: true }
    );
  } catch (e) {
    // 模型不认图片时退回纯文字，别让整步失败
    if (!withVision) throw e;
    raw = await callLLM(
      [{ role: 'system', content: system }, {
        role: 'user',
        content: text + '\n（参考图无法传给当前模型，请仅依据文字信息推演。）',
      }],
      { temperature: 0.95, json: true }
    );
  }
  const data = parseJson(raw);
  const groups = Array.isArray(data.groups) ? data.groups : (Array.isArray(data) ? data : []);
  if (!groups.length) throw new Error('模型没有给出可用的方向');

  return groups.slice(0, 3).map((g, i) => ({
    name: str(g.name, 30) || `方向 ${i + 1}`,
    tagline: str(g.tagline, 80),
    theme: str(g.theme, 80),
    concept: str(g.concept, 220),
    costume: arr(g.costume, 6),
    style: arr(g.style, 5),
    props: arr(g.props, 7),
    palette: arr(g.palette, 6).filter((x) => /^#[0-9a-f]{3,8}$/i.test(x)),
    keywords: arr(g.keywords, 7),
    time: str(g.time, 60),
    location: str(g.location, 100),
    picked: { costume: [], style: [], props: [] },
    preview: [],
  }));
}

/* ---------------------------------------------------------- 视觉识别 */

export async function analyzeShot(shot, group = {}) {
  if (!hasVision()) throw new Error('接口缺少可用的模型名，请检查设置');
  const src = shotSrc(shot, 'card');
  if (!src) throw new Error('图片为空');
  const dataUrl = await toDataUrl(src, 1024, 0.82);

  const system = '你是摄影技术分析助手。只输出 JSON，不要解释。';
  const text = `分析这张参考图的拍摄属性。${group.theme ? '拍摄主题：' + group.theme + '。' : ''}
${DIM_RULES}

另外给出：
- title：6–12 字画面标题
- props：画面中出现的具体道具（0–3 个中文名词；不要写椅子、桌子、墙这类场景固定物）
- expression：人物神态或表情，14 字以内；没有人写「空镜」
- action：画面中的动作，或拍摄时可复用的引导动作，22 字以内

只输出 JSON：
{"title":"","props":[],"shotSize":"","direction":"","angle":"","focal":"","composition":[],"light":"","expression":"","action":""}`;

  const cred = activeCred();
  const raw = await callLLM(
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    {
      model: visionModelOf(cred),
      endpoint: { baseUrl: cred.visionBaseUrl || cred.baseUrl, apiKey: cred.visionApiKey || cred.apiKey },
      temperature: 0.2,
      json: true,
      fast: true,
    }
  );

  const o = parseJson(raw);
  return {
    title: str(o.title, 40),
    props: arr(o.props, 4),
    shotSize: OPTIONS.shotSize.includes(o.shotSize) ? o.shotSize : '',
    direction: OPTIONS.direction.includes(o.direction) ? o.direction : '',
    angle: OPTIONS.angle.includes(o.angle) ? o.angle : '',
    focal: OPTIONS.focal.includes(o.focal) ? o.focal : '',
    composition: (Array.isArray(o.composition) ? o.composition : []).filter((x) => OPTIONS.composition.includes(x)).slice(0, 3),
    light: OPTIONS.light.includes(o.light) ? o.light : '柔光',
    expression: str(o.expression, 40),
    action: str(o.action, 60),
  };
}

/* ---------------------------------------------------------- 撰写策划 */

export async function composePlan({ group, shots, analyses, freeform }) {
  const list = shots.map((s, i) => {
    const a = analyses && analyses[i];
    const bits = [`[${i + 1}] 检索词：${s.query || s.title || '参考图'}`];
    if (s.title) bits.push('标题：' + s.title);
    if (a) bits.push('视觉分析：' + JSON.stringify(a));
    return bits.join(' ｜ ');
  }).join('\n');

  let system = `你是拍摄现场的摄影指导，负责把参考图整理成一份可直接执行的分镜脚本。
规则：
1. 只输出 JSON，不要解释。
2. shots 数量必须等于参考图数量，i 从 1 开始，与图片序号一一对应。
3. ${DIM_RULES}
4. 若有「视觉分析」，属性与道具必须以视觉分析为准，不得凭空改写；只有缺失项才补充。若没有视觉分析，则按检索词与标题合理设定。
5. 每张图写 expression（神态/表情，14 字以内）与 action（动作引导，22 字以内），要具体、可执行，不要形容词堆砌。
6. 道具只能从方向的道具清单里选，0–3 个；宁少勿多。
7. 主题、概念、服装、风格、时间、地点要与方向一致，可细化但不能推翻。`;
  if (freeform) {
    system += `\n8. 这次没有预设方向：主题、概念、服装、风格、道具、时间、地点都由你根据参考图与用户的补充信息决定。用户给了主题就沿用，不要另起；没给就根据画面气质自己命名。`;
  }

  const text = `${freeform ? '方向信息（可能不完整，需要你补全）' : '已确认方向'}：
主题：${group.theme || group.name}
概念：${group.concept || ''}
服装：${(group.costume || []).join('、')}
风格：${(group.style || []).join('、')}
道具：${(group.props || []).join('、')}
时间：${group.time || ''}
地点：${group.location || ''}

参考图清单（共 ${shots.length} 张）：
${list}

输出 JSON：
{"theme":"","concept":"","costume":[],"style":[],"props":[],"time":"","location":"","shots":[{"i":1,"title":"","expression":"","action":"","props":[],"shotSize":"","direction":"","angle":"","focal":"","composition":[],"light":""}]}`;

  const raw = await callLLM(
    [{ role: 'system', content: system }, { role: 'user', content: text }],
    { temperature: 0.65, json: true, fast: true }
  );
  return parseJson(raw);
}

/* ---------------------------------------------------------- 连接测试 */

export async function testConnection(cred) {
  const raw = await callLLM(
    [{ role: 'user', content: '只回复两个字：可用' }],
    { cred, json: false, temperature: 0, maxTokens: 24, fast: true }
  );
  return str(raw, 40);
}

/* ------------------------------------------------------ 生成结果落地 */

export function shotsFrom(items, result, analyses, fallbackProps) {
  const list = Array.isArray(result && result.shots) ? result.shots : [];
  return items.map((it, idx) => {
    const r = list.find((x) => Number(x && x.i) === idx + 1) || list[idx] || {};
    const a = (analyses && analyses[idx]) || null;
    const props = (() => {
      const rv = Array.isArray(r.props) ? r.props : [];
      const av = Array.isArray(a && a.props) ? a.props : [];
      const merged = (rv.length ? rv : av).map((x) => str(x, 24)).filter(Boolean);
      const allowed = Array.isArray(fallbackProps) && fallbackProps.length ? fallbackProps : null;
      const filtered = allowed ? merged.filter((p) => allowed.includes(p)) : merged;
      return (filtered.length ? filtered : merged).slice(0, 3);
    })();
    return {
      id: 'sh_' + Math.random().toString(36).slice(2, 8),
      url: it.url,
      thumb: it.thumb || '',
      title: str(r.title || (a && a.title) || it.title || '', 40),
      props,
      shotSize: OPTIONS.shotSize.includes(r.shotSize) ? r.shotSize : ((a && a.shotSize) || ''),
      direction: OPTIONS.direction.includes(r.direction) ? r.direction : ((a && a.direction) || ''),
      angle: OPTIONS.angle.includes(r.angle) ? r.angle : ((a && a.angle) || ''),
      focal: OPTIONS.focal.includes(r.focal) ? r.focal : ((a && a.focal) || ''),
      composition: (Array.isArray(r.composition) && r.composition.length ? r.composition : ((a && a.composition) || []))
        .filter((x) => OPTIONS.composition.includes(x)).slice(0, 2),
      light: OPTIONS.light.includes(r.light) ? r.light : ((a && a.light) || '柔光'),
      expression: str(r.expression || (a && a.expression) || '', 48),
      action: str(r.action || (a && a.action) || '', 64),
      note: '',
    };
  });
}


/* ---------------------------------------------------------- 读图自检 */

export async function testVision(cred) {
  const c = cred || activeCred();
  if (!c) throw new Error('没有可用的接口');
  const canvas = document.createElement('canvas');
  canvas.width = 180;
  canvas.height = 130;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, 180, 130);
  ctx.fillStyle = '#a34e33';
  ctx.beginPath();
  ctx.arc(90, 52, 32, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1916';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TEST 123', 90, 112);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

  const raw = await callLLM(
    [{
      role: 'user',
      content: [
        { type: 'text', text: '这张图里有什么？用一句话回答。' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
    {
      cred: c,
      model: visionModelOf(c),
      endpoint: { baseUrl: c.visionBaseUrl || c.baseUrl, apiKey: c.visionApiKey || c.apiKey },
      json: false,
      temperature: 0,
      maxTokens: 80,
      fast: true,
    }
  );
  return str(raw, 80);
}
