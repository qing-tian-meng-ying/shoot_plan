import {
  state, shotSrc, shotTags, sectionsFor, loadImage, pad2, fmtDate, toast, openModal,
  safeName, downloadBlob,
} from './core.js';

const W = 1240;
const PAD = 72;
const GAP = 40;
const COLS = 2;
const CW = Math.floor((W - PAD * 2 - GAP) / COLS);
const IH = Math.round(CW * 1.25);

const SERIF = '"Songti SC","STSong","Noto Serif SC","SimSun",serif';
const SANS = '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
const SCALE = 1.8; // 全局字号缩放：1 = 原始大小（字体/行高/文字间距一起等比缩放）
const INK = '#1b1916';
const INK2 = '#453f37';
const MUTED = '#8b8174';
const LINE = '#ddd4c5';
const ACCENT = '#a34e33';
const PAPER = '#f4f1ea';

const F = {
  serif: (size, weight = 600) => `${weight} ${Math.round(size * SCALE)}px ${SERIF}`,
  sans: (size, weight = 400) => `${weight} ${Math.round(size * SCALE)}px ${SANS}`,
};

function wrapText(ctx, text, maxW) {
  const str = String(text || '');
  if (!str) return [];
  const out = [];
  let line = '';
  for (const ch of str) {
    if (ch === '\n') { out.push(line); line = ''; continue; }
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      out.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) out.push(line);
  return out;
}

function ellipsis(lines, maxLines) {
  if (!lines.length) return lines;
  if (lines.length <= maxLines) return lines;
  const cut = lines.slice(0, maxLines);
  cut[maxLines - 1] = cut[maxLines - 1].slice(0, -1) + '…';
  return cut;
}

function showOverlay() {
  const el = document.createElement('div');
  el.className = 'exporting';
  el.innerHTML = `<div class="spinner"></div><div class="et">正在合成长图</div><div class="es">准备中…</div><div class="bar"><i style="width:0%"></i></div>`;
  document.body.appendChild(el);
  return {
    set(text, pct) {
      const s = el.querySelector('.es');
      const b = el.querySelector('.bar i');
      if (s) s.textContent = text;
      if (b && pct != null) b.style.width = Math.max(2, Math.min(100, Math.round(pct * 100))) + '%';
    },
    close() { el.remove(); },
  };
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

export async function exportLongImage() {
  const secs = sectionsFor();
  const shots = secs.flatMap((s) => s.items);
  if (!shots.length) { toast('没有可导出的图片', 'warn'); return; }

  const overlay = showOverlay();
  try {
    await (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve());

    const uniq = [];
    const seen = new Set();
    for (const s of shots) if (!seen.has(s.id)) { seen.add(s.id); uniq.push(s); }

    const imgs = new Map();
    let loaded = 0;
    await pool(uniq, 4, async (s) => {
      let img = null;
      try {
        img = await loadImage(shotSrc(s, 'full'), 25000);
      } catch (e) {
        try {
          img = await loadImage(shotSrc(s, 'card'), 20000);
        } catch (e2) {
          img = null;
        }
      }
      imgs.set(s.id, img);
      loaded += 1;
      overlay.set(`正在加载图片 ${loaded} / ${uniq.length}`, (loaded / uniq.length) * 0.85);
    });

    overlay.set('正在排版…', 0.9);

    const plan = state.plan;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const frames = [];
    let y = 64 * SCALE;

    const text = (lines, opt) => {
      if (!lines || !lines.length) return;
      const lh = (opt.lh || 20) * SCALE;
      frames.push({
        type: 'text',
        lines,
        x: opt.x == null ? PAD : opt.x,
        y,
        font: opt.font,
        color: opt.color || INK,
        lh,
        align: opt.align || 'left',
        spacing: (opt.spacing || 0) * SCALE,
      });
      y += lines.length * lh + (opt.after || 0) * SCALE;
    };

    const measure = (str, font, maxW, spacing = 0) => {
      ctx.font = font;
      if ('letterSpacing' in ctx) ctx.letterSpacing = spacing + 'px';
      const lines = wrapText(ctx, str, maxW);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      return lines;
    };

    /* ---------------- 封面 ---------------- */
    const kicker = `SHOOTING PLAN   ·   ${fmtDate(new Date(plan.updatedAt || Date.now()))}   ·   ${plan.shots.length} FRAMES`;
    text([kicker], { font: F.sans(10, 500), color: MUTED, lh: 14, spacing: 2, after: 34 });

    const themeLines = measure(plan.theme || '未命名拍摄', F.serif(52), W - PAD * 2);
    text(themeLines, { font: F.serif(52), color: INK, lh: 64, after: 18 });

    if (plan.concept) {
      const cLines = measure(plan.concept, F.sans(15), 900 * SCALE);
      text(cLines, { font: F.sans(15), color: INK2, lh: 30, after: 22 });
    }

    y += 14 * SCALE;
    frames.push({ type: 'line', x1: PAD, y1: y, x2: W - PAD, y2: y, color: LINE });
    y += 26 * SCALE;

    const meta = [
      ['服装期望', (plan.costume || []).join(' · ')],
      ['风格形式', (plan.style || []).join(' · ')],
      ['道具', (plan.props || []).join(' · ')],
      ['时间', plan.time],
      ['地点', plan.location],
    ].filter(([, v]) => v && String(v).trim());

    for (const [label, value] of meta) {
      ctx.font = F.sans(14);
      const vLines = wrapText(ctx, value, W - PAD * 2 - 116 * SCALE);
      frames.push({ type: 'text', lines: [label], x: PAD, y: y + 3 * SCALE, font: F.sans(10.5, 500), color: MUTED, lh: 20 * SCALE, spacing: 1 * SCALE });
      frames.push({ type: 'text', lines: vLines, x: PAD + 116 * SCALE, y, font: F.sans(14), color: INK, lh: 24 * SCALE });
      y += (Math.max(24, vLines.length * 24) + 12) * SCALE;
    }

    y += 10 * SCALE;
    frames.push({ type: 'line', x1: PAD, y1: y, x2: W - PAD, y2: y, color: LINE });
    y += 34 * SCALE;

    /* ---------------- 分镜 ---------------- */
    for (const sec of secs) {
      if (state.ui.dim) {
        let x = PAD;
        const parts = [
          { t: sec.label, f: F.serif(22), c: INK, dy: 0, sp: 0 },
          { t: (sec.en || '').toUpperCase(), f: F.sans(9.5, 500), c: MUTED, dy: 9 * SCALE, sp: 2 * SCALE },
        ];
        for (const p of parts) {
          if (!p.t) continue;
          ctx.font = p.f;
          if ('letterSpacing' in ctx) ctx.letterSpacing = p.sp + 'px';
          const w = ctx.measureText(p.t).width;
          if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
          frames.push({ type: 'text', lines: [p.t], x, y: y + p.dy, font: p.f, color: p.c, lh: 26 * SCALE, spacing: p.sp });
          x += w + 12 * SCALE;
        }
        frames.push({ type: 'line', x1: x + 4, y1: y + 14 * SCALE, x2: W - PAD - 44, y2: y + 14 * SCALE, color: LINE });
        frames.push({ type: 'text', lines: [String(sec.items.length)], x: W - PAD, y: y + 2 * SCALE, font: F.serif(13), color: MUTED, lh: 20 * SCALE, align: 'right' });
        y += 32 * SCALE;
      }

      for (let i = 0; i < sec.items.length; i += COLS) {
        const row = sec.items.slice(i, i + COLS);
        const metas = row.map((s) => {
          const title = ellipsis(measure(s.title || '', F.serif(15), CW - 30 * SCALE), 1);
          const exprText = (s.expression || '').trim();
          const actText = (s.action || '').trim();
          const expr = exprText && !/^[—\-－]+$/.test(exprText) ? ellipsis(measure(exprText, F.sans(12.5), CW - 40 * SCALE), 2) : [];
          const act = actText && !/^[—\-－]+$/.test(actText) ? ellipsis(measure(actText, F.sans(12.5), CW - 40 * SCALE), 2) : [];
          const tagStr = shotTags(s).map((t) => `${t.k} ${t.v}`).join('  ·  ');
          const tags = tagStr ? ellipsis(measure(tagStr, F.sans(10), CW), 2) : [];
          const h = (24 + expr.length * 19 + act.length * 19 + (tags.length ? 8 + tags.length * 15 : 0) + 4) * SCALE;
          return { title, expr, act, tags, h };
        });

        const rowH = IH + Math.max(...metas.map((m) => m.h)) + 40 * SCALE;

        row.forEach((s, j) => {
          const x = PAD + j * (CW + GAP);
          const img = imgs.get(s.id);
          frames.push({ type: 'img', img, x, y, w: CW, h: IH });

          let cy = y + IH + 12 * SCALE;
          const idx = state.plan.shots.findIndex((z) => z.id === s.id) + 1;
          frames.push({ type: 'text', lines: [pad2(idx)], x, y: cy + 2 * SCALE, font: F.serif(11), color: ACCENT, lh: 18 * SCALE });
          if (metas[j].title.length) {
            frames.push({ type: 'text', lines: metas[j].title, x: x + 30 * SCALE, y: cy, font: F.serif(15), color: INK, lh: 22 * SCALE });
          }
          cy += 24 * SCALE;

          if (metas[j].expr.length) {
            frames.push({ type: 'text', lines: ['神态'], x, y: cy + 2 * SCALE, font: F.sans(10), color: MUTED, lh: 17 * SCALE });
            frames.push({ type: 'text', lines: metas[j].expr, x: x + 36 * SCALE, y: cy, font: F.sans(12.5), color: INK2, lh: 19 * SCALE });
            cy += metas[j].expr.length * 19 * SCALE;
          }
          if (metas[j].act.length) {
            frames.push({ type: 'text', lines: ['动作'], x, y: cy + 2 * SCALE, font: F.sans(10), color: MUTED, lh: 17 * SCALE });
            frames.push({ type: 'text', lines: metas[j].act, x: x + 36 * SCALE, y: cy, font: F.sans(12.5), color: INK2, lh: 19 * SCALE });
            cy += metas[j].act.length * 19 * SCALE;
          }
          if (metas[j].tags.length) {
            cy += 8 * SCALE;
            frames.push({ type: 'text', lines: metas[j].tags, x, y: cy, font: F.sans(10), color: MUTED, lh: 15 * SCALE });
          }
        });

        y += rowH;
      }
    }

    /* ---------------- 页脚 ---------------- */
    y += 10 * SCALE;
    frames.push({ type: 'line', x1: PAD, y1: y, x2: W - PAD, y2: y, color: LINE });
    y += 16 * SCALE;
    frames.push({ type: 'text', lines: ['拍摄策划 · ' + (plan.theme || '未命名')], x: PAD, y, font: F.sans(10, 500), color: MUTED, lh: 16 * SCALE, spacing: 1 * SCALE });
    frames.push({ type: 'text', lines: [`${fmtDate()} · ${shots.length} FRAMES`], x: W - PAD, y, font: F.sans(10, 500), color: MUTED, lh: 16 * SCALE, spacing: 1 * SCALE, align: 'right' });
    y += 46 * SCALE;

    /* ---------------- 绘制 ---------------- */
    const totalH = Math.ceil(y);
    canvas.width = W;
    canvas.height = totalH;
    const c = canvas.getContext('2d');
    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, totalH);
    c.textBaseline = 'top';

    for (const f of frames) {
      if (f.type === 'line') {
        c.strokeStyle = f.color;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(f.x1, f.y1 + 0.5);
        c.lineTo(f.x2, f.y2 + 0.5);
        c.stroke();
      } else if (f.type === 'img') {
        if (f.img && f.img.width) {
          const iw = f.img.naturalWidth || f.img.width;
          const ih = f.img.naturalHeight || f.img.height;
          const r = Math.max(f.w / iw, f.h / ih);
          const sw = f.w / r;
          const sh = f.h / r;
          c.drawImage(f.img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, f.x, f.y, f.w, f.h);
        } else {
          c.fillStyle = '#e6dfd1';
          c.fillRect(f.x, f.y, f.w, f.h);
          c.fillStyle = '#a99e8e';
          c.font = F.sans(12);
          c.textAlign = 'center';
          c.fillText('图片未能加载', f.x + f.w / 2, f.y + f.h / 2 - 8 * SCALE);
          c.textAlign = 'left';
        }
        c.strokeStyle = 'rgba(27,25,22,.1)';
        c.lineWidth = 1;
        c.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1);
      } else if (f.type === 'text') {
        c.font = f.font;
        c.fillStyle = f.color;
        c.textAlign = f.align || 'left';
        if (f.spacing && 'letterSpacing' in c) c.letterSpacing = f.spacing + 'px';
        for (let i = 0; i < f.lines.length; i++) {
          c.fillText(f.lines[i], f.x, f.y + i * f.lh);
        }
        if (f.spacing && 'letterSpacing' in c) c.letterSpacing = '0px';
        c.textAlign = 'left';
      }
    }

    overlay.set('正在导出 PNG…', 0.97);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    overlay.close();
    if (!blob) { toast('导出失败，请重试', 'warn'); return; }

    const url = URL.createObjectURL(blob);
    const name = `拍摄策划_${safeName(plan.theme)}_${fmtDate().replace(/\./g, '')}.png`;
    showPreview(url, blob, name, canvas.width, canvas.height);
    setTimeout(() => downloadBlob(blob, name), 260);
  } catch (e) {
    overlay.close();
    console.error(e);
    toast('导出失败：' + e.message, 'warn');
  }
}

function showPreview(url, blob, name, w, h) {
  const size = blob.size > 1024 * 1024 ? (blob.size / 1024 / 1024).toFixed(1) + ' MB' : Math.round(blob.size / 1024) + ' KB';
  const modal = openModal(`
    <div class="modal" style="width:min(780px,100%)">
      <div class="modal-head">
        <div><div class="ed-kicker">LONG IMAGE</div><h3>长图已生成</h3></div>
        <button class="x" data-close>×</button>
      </div>
      <div class="export-prev">
        <div class="scroll"><img src="${url}" alt="长图预览"></div>
        <p class="hint" style="margin-top:12px">${w} × ${h} px · ${size} · 已开始下载</p>
      </div>
      <div class="modal-foot">
        <div class="grow"></div>
        <button class="btn" data-close>关闭</button>
        <a class="btn primary" href="${url}" download="${name}">下载 PNG</a>
      </div>
    </div>`, {
    onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000),
  });
  modal.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => modal.close()));
}
