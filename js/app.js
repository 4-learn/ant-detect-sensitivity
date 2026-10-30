import {
  STUDENT_DEFAULTS, STATUS, SWEEPABLE,
  computeGrayStats, computeDiffs, evaluate,
  baitAdvice, scoreAgainstLabels, rangeValues,
} from './algorithm.js';
import { makeDemoFrames } from './demo.js';

// ---------------------------------------------------------------------
// 狀態
// ---------------------------------------------------------------------
const PARAM_UI = [
  { key: 'darkThreshold', label: '暗像素閾值', desc: 'gray 小於此值算暗像素', min: 0, max: 255, step: 1 },
  { key: 'ratioMin', label: '暗像素比例下限', desc: 'ratio 大於此值才可能判有螞蟻', min: 0, max: 0.2, step: 0.001 },
  { key: 'ratioMax', label: '暗像素比例上限', desc: 'ratio ≥ 此值判為陰影/雜物', min: 0, max: 1, step: 0.005 },
  { key: 'motionThreshold', label: '移動量閾值', desc: 'avgDiff 大於此值判「活動中」', min: 0, max: 20, step: 0.05 },
  { key: 'wR', label: '灰階權重 R', desc: '改這三個會重算整張圖', min: 0, max: 1, step: 0.001 },
  { key: 'wG', label: '灰階權重 G', desc: '', min: 0, max: 1, step: 0.001 },
  { key: 'wB', label: '灰階權重 B', desc: '', min: 0, max: 1, step: 0.001 },
];

const STATUS_META = {
  [STATUS.ACTIVE]: { text: '🐜 活動中', cls: 's-active', color: '#f43f5e' },
  [STATUS.DEAD]: { text: '☠️ 群聚無位移', cls: 's-dead', color: '#a855f7' },
  [STATUS.CLUTTER]: { text: '⚠️ 陰影/雜物', cls: 's-clutter', color: '#f59e0b' },
  [STATUS.NONE]: { text: '✅ 無琉璃蟻', cls: 's-none', color: '#22c55e' },
};
const STATUS_ORDER = [STATUS.ACTIVE, STATUS.DEAD, STATUS.CLUTTER, STATUS.NONE];

const state = {
  params: { ...STUDENT_DEFAULTS },
  frames: [],   // { name, url, img, width, height, rgba, stats, label }
  diffs: [],
  selected: -1,
  sweep1: null,
  sweep2: null,
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// 影像載入
// ---------------------------------------------------------------------
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('無法讀取圖片'));
    img.src = url;
  });
}

function rasterize(img) {
  const target = Number($('resize_mode').value);
  let w = img.naturalWidth, h = img.naturalHeight;
  if (target > 0 && w !== target) {
    h = Math.max(1, Math.round(h * target / w));
    w = target;
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { width: w, height: h, rgba: ctx.getImageData(0, 0, w, h).data };
}

async function addFiles(files, labels = {}) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  for (const f of list) {
    const url = URL.createObjectURL(f);
    try {
      const img = await loadImage(url);
      state.frames.push({ name: f.name, url, img, label: labels[f.name] || '' });
    } catch (e) {
      console.warn(f.name, e);
    }
  }
  state.frames.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (state.selected < 0 && state.frames.length) state.selected = 0;
  reprocessAll();
}

function reprocessAll() {
  for (const f of state.frames) {
    const r = rasterize(f.img);
    f.width = r.width; f.height = r.height; f.rgba = r.rgba;
  }
  recomputeStats();
}

function recomputeStats() {
  for (const f of state.frames) {
    f.stats = computeGrayStats(f.rgba, f.width, f.height, state.params);
  }
  state.diffs = computeDiffs(state.frames.map((f) => f.stats));
  refresh();
}

// ---------------------------------------------------------------------
// 參數面板
// ---------------------------------------------------------------------
function buildParams() {
  const box = $('param_box');
  box.innerHTML = '';
  for (const p of PARAM_UI) {
    const el = document.createElement('div');
    el.className = 'param';
    el.id = 'param_' + p.key;
    el.innerHTML = `
      <div class="top">
        <span class="name">${p.label}</span>
        <input type="number" step="${p.step}" min="${p.min}" data-k="${p.key}" data-role="num">
      </div>
      <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" data-k="${p.key}" data-role="range">
      <div class="def">學生預設：${STUDENT_DEFAULTS[p.key]}${p.desc ? '　·　' + p.desc : ''}</div>`;
    box.appendChild(el);
  }
  box.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const v = parseFloat(e.target.value);
    if (!isFinite(v)) return;
    setParam(k, v);
  });
  syncParamUI();
}

function setParam(k, v) {
  state.params[k] = v;
  syncParamUI();
  if (k === 'wR' || k === 'wG' || k === 'wB') recomputeStats();
  else refresh();
}

function syncParamUI() {
  for (const p of PARAM_UI) {
    const v = state.params[p.key];
    const el = $('param_' + p.key);
    for (const inp of el.querySelectorAll('input')) {
      if (document.activeElement !== inp) inp.value = v;
    }
    el.classList.toggle('changed', v !== STUDENT_DEFAULTS[p.key]);
  }
}

// ---------------------------------------------------------------------
// 結果表
// ---------------------------------------------------------------------
function currentResults() {
  return state.frames.map((f, i) => evaluate(f.stats, state.diffs[i], state.params));
}

function badge(status) {
  const m = STATUS_META[status];
  return `<span class="badge ${m.cls}">${m.text}</span>`;
}

function renderTable() {
  const wrap = $('img_table_wrap');
  if (!state.frames.length) { wrap.innerHTML = ''; return; }
  const res = currentResults();
  const preds = res.map((r) => r.status);
  const score = scoreAgainstLabels(preds, state.frames.map((f) => f.label));
  let html = `<table><thead><tr>
    <th>#</th><th>縮圖</th><th>檔名</th><th>尺寸</th>
    <th>暗像素比例</th><th>移動量 avgDiff</th><th>判定</th><th>人工標註</th><th></th>
  </tr></thead><tbody>`;
  state.frames.forEach((f, i) => {
    const r = res[i];
    const sizeWarn = i > 0 && (state.frames[i - 1].width !== f.width || state.frames[i - 1].height !== f.height);
    const pred = r.status === STATUS.CLUTTER ? 'none' : r.status;
    const mark = f.label ? (pred === f.label ? '✔' : '✘') : '';
    html += `<tr data-i="${i}" class="${i === state.selected ? 'sel' : ''}">
      <td>${i + 1}</td>
      <td><img src="${f.url}" alt=""></td>
      <td title="${escapeHtml(f.name)}">${escapeHtml(truncate(f.name, 28))}</td>
      <td>${f.width}×${f.height}${sizeWarn ? ' <span title="與前一張尺寸不同，移動量會是 0">⚠️</span>' : ''}</td>
      <td class="num">${(r.ratio * 100).toFixed(2)}%</td>
      <td class="num">${i === 0 ? '<span class="hint">（第一張）</span> ' : ''}${r.avgDiff.toFixed(3)}</td>
      <td>${badge(r.status)}</td>
      <td><select data-label="${i}">
        <option value="">—</option>
        <option value="active"${f.label === 'active' ? ' selected' : ''}>🐜 活動中</option>
        <option value="dead"${f.label === 'dead' ? ' selected' : ''}>☠️ 無位移</option>
        <option value="none"${f.label === 'none' ? ' selected' : ''}>✅ 無螞蟻</option>
      </select></td>
      <td>${mark}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  if (score.labeled) {
    html += `<div class="info">目前參數下（已標註 ${score.labeled} 張）：準確率 <b>${pct(score.accuracy)}</b>　·　偵出率 <b>${pct(score.sensitivity)}</b>　·　特異度 <b>${pct(score.specificity)}</b></div>`;
  }
  wrap.innerHTML = html;
}

function pct(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------------------------------------------------------------------
// 預覽
// ---------------------------------------------------------------------
function renderPreview() {
  const cv = $('preview_canvas');
  const f = state.frames[state.selected];
  $('preview_empty').style.display = f ? 'none' : '';
  if (!f) {
    cv.width = 0; cv.height = 0;
    $('preview_info').innerHTML = ''; $('bait_box').innerHTML = '';
    drawHist(null);
    return;
  }
  cv.width = f.width; cv.height = f.height;
  const ctx = cv.getContext('2d');
  const out = ctx.createImageData(f.width, f.height);
  const d = out.data, src = f.rgba;
  const showMask = $('show_mask').checked;
  const { wR, wG, wB, darkThreshold } = state.params;
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    const gray = wR * src[i] + wG * src[i + 1] + wB * src[i + 2];
    if (showMask && gray < darkThreshold) {
      d[i] = 255; d[i + 1] = 30; d[i + 2] = 60; d[i + 3] = 255;
    } else {
      d[i] = src[i]; d[i + 1] = src[i + 1]; d[i + 2] = src[i + 2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  const r = evaluate(f.stats, state.diffs[state.selected], state.params);
  if ($('show_box').checked && (r.status === STATUS.ACTIVE || r.status === STATUS.DEAD)) {
    ctx.strokeStyle = STATUS_META[r.status].color;
    ctx.lineWidth = Math.max(2, f.width / 300);
    ctx.strokeRect(f.width * 0.3, f.height * 0.3, f.width * 0.4, f.height * 0.4);
  }

  $('preview_info').innerHTML = `
    <b>${escapeHtml(f.name)}</b>（第 ${state.selected + 1} 張，${f.width}×${f.height}）<br>
    暗像素：<b>${r.darkPixels.toLocaleString()}</b> / ${f.stats.total.toLocaleString()}
    → ratio = <b>${(r.ratio * 100).toFixed(3)}%</b>
    （範圍 ${(state.params.ratioMin * 100).toFixed(2)}% ~ ${(state.params.ratioMax * 100).toFixed(2)}%）<br>
    移動量 avgDiff = <b>${r.avgDiff.toFixed(3)}</b>（閾值 ${state.params.motionThreshold}）
    ${state.selected === 0 ? '<span class="hint">第一張沒有前一張，學生程式算成 0</span>' : ''}<br>
    判定：${badge(r.status)}　
    ${margins(r)}`;

  const b = baitAdvice(r.status);
  $('bait_box').innerHTML = `<b>學生程式的誘餌建議</b><br>
    硼砂 ${b.borax}%　·　糖漿 ${b.sugar}%　·　水 ${b.water}%<br>
    <span class="hint">${b.advice}</span>`;
  drawHist(f.stats.hist);
}

/** 顯示距離切換判定還差多少，方便看「這張有多接近邊界」。 */
function margins(r) {
  const p = state.params;
  const parts = [];
  parts.push(`ratio 距下限 ${fmtSigned((r.ratio - p.ratioMin) * 100)}pt、距上限 ${fmtSigned((p.ratioMax - r.ratio) * 100)}pt`);
  parts.push(`avgDiff 距閾值 ${fmtSigned(r.avgDiff - p.motionThreshold)}`);
  return `<br><span class="hint">邊界餘裕：${parts.join('；')}</span>`;
}
function fmtSigned(v) { return (v >= 0 ? '+' : '') + v.toFixed(3); }

function drawHist(hist) {
  const cv = $('hist_canvas');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  if (!hist) return;
  const pad = 20;
  let max = 1;
  for (let i = 0; i < 256; i++) max = Math.max(max, hist[i]);
  const bw = (W - pad * 2) / 256;
  const t = state.params.darkThreshold;
  for (let i = 0; i < 256; i++) {
    const h = (hist[i] / max) * (H - pad * 2);
    ctx.fillStyle = i < t ? '#f43f5e' : '#38bdf8';
    ctx.fillRect(pad + i * bw, H - pad - h, Math.max(1, bw), h);
  }
  ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 2;
  const x = pad + Math.min(256, t) * bw;
  ctx.beginPath(); ctx.moveTo(x, pad / 2); ctx.lineTo(x, H - pad); ctx.stroke();
  ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif';
  ctx.fillText('0', pad, H - 5); ctx.fillText('255', W - pad - 18, H - 5);
  ctx.fillText('T=' + t, Math.min(x + 4, W - 50), pad);
}

// ---------------------------------------------------------------------
// 單參數掃描
// ---------------------------------------------------------------------
function fillParamSelect(sel, value) {
  sel.innerHTML = Object.entries(SWEEPABLE).map(([k, v]) => `<option value="${k}">${v.label} (${k})</option>`).join('');
  sel.value = value;
}

const SWEEP_PRESET = {
  darkThreshold: [20, 160, 2],
  ratioMin: [0, 0.1, 0.002],
  ratioMax: [0.05, 0.6, 0.01],
  motionThreshold: [0, 10, 0.1],
};

function presetRange(prefix, key) {
  const [a, b, s] = SWEEP_PRESET[key];
  $(prefix + '_from').value = a; $(prefix + '_to').value = b; $(prefix + '_step').value = s;
}

function readRange(prefix) {
  const key = $(prefix + '_param').value;
  const vals = rangeValues(parseFloat($(prefix + '_from').value), parseFloat($(prefix + '_to').value),
    parseFloat($(prefix + '_step').value), SWEEPABLE[key].integer, 400);
  return { key, vals };
}

function runSweep1() {
  if (!state.frames.length) return alert('請先上傳影像或載入示範圖組');
  const { key, vals } = readRange('sw1');
  if (!vals.length) return alert('掃描範圍不正確');
  const labels = state.frames.map((f) => f.label);
  const rows = vals.map((v) => {
    const p = { ...state.params, [key]: v };
    const statuses = state.frames.map((f, i) => evaluate(f.stats, state.diffs[i], p).status);
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, statuses.filter((x) => x === s).length]));
    return { value: v, statuses, counts, score: scoreAgainstLabels(statuses, labels) };
  });
  state.sweep1 = { key, vals, rows };
  $('btn_csv1').disabled = false;
  renderSweep1();
}

function renderSweep1() {
  const sw = state.sweep1;
  if (!sw) return;
  drawStrip(sw);
  drawLines(sw);
  // 摘要：判定切換點、最佳值
  const lines = [];
  const cur = state.params[sw.key];
  lines.push(`掃描 <b>${SWEEPABLE[sw.key].label}</b>：${sw.vals[0]} → ${sw.vals[sw.vals.length - 1]}，共 ${sw.vals.length} 個值（目前值 ${cur}）`);
  state.frames.forEach((f, i) => {
    const flips = [];
    for (let k = 1; k < sw.rows.length; k++) {
      const a = sw.rows[k - 1].statuses[i], b = sw.rows[k].statuses[i];
      if (a !== b) flips.push(`${sw.rows[k].value} 起 ${STATUS_META[a].text}→${STATUS_META[b].text}`);
    }
    if (flips.length) lines.push(`#${i + 1} ${escapeHtml(truncate(f.name, 24))}：${flips.join('，')}`);
  });
  const scored = sw.rows.filter((r) => r.score.accuracy != null);
  if (scored.length) {
    const best = Math.max(...scored.map((r) => r.score.accuracy));
    const bestVals = scored.filter((r) => r.score.accuracy === best).map((r) => r.value);
    lines.push(`最高準確率 <b>${pct(best)}</b>，出現在 ${sw.key} = <b>${summarizeVals(bestVals)}</b>`);
  }
  $('sweep1_summary').innerHTML = lines.join('<br>');
}

function summarizeVals(vals) {
  if (vals.length <= 4) return vals.join(', ');
  return `${vals[0]} ~ ${vals[vals.length - 1]}（${vals.length} 個值）`;
}

function setupCanvas(cv, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 800;
  cv.style.height = cssH + 'px';
  cv.width = Math.round(w * dpr); cv.height = Math.round(cssH * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, cssH);
  return { ctx, w, h: cssH };
}

const PAD = { l: 150, r: 20, t: 14, b: 34 };

function xAxis(ctx, sw, w, h, plotW) {
  ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  const n = sw.vals.length;
  const ticks = Math.min(8, n);
  for (let t = 0; t < ticks; t++) {
    const k = Math.round(t * (n - 1) / Math.max(1, ticks - 1));
    const x = PAD.l + (k + 0.5) * plotW / n;
    ctx.fillText(String(sw.vals[k]), x, h - PAD.b + 16);
  }
  // 目前值
  const cur = state.params[sw.key];
  const k = nearestIndex(sw.vals, cur);
  if (k >= 0) {
    const x = PAD.l + (k + 0.5) * plotW / n;
    ctx.strokeStyle = '#eab308'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, h - PAD.b); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#eab308'; ctx.fillText('目前值', x, h - 4);
  }
  ctx.textAlign = 'left';
}

function nearestIndex(vals, v) {
  let best = -1, bd = Infinity;
  vals.forEach((x, i) => { const d = Math.abs(x - v); if (d < bd) { bd = d; best = i; } });
  const span = vals.length > 1 ? Math.abs(vals[1] - vals[0]) : 1;
  return bd <= span ? best : -1;
}

function drawStrip(sw) {
  const cv = $('strip_canvas');
  const rowH = Math.max(10, Math.min(28, 260 / state.frames.length));
  const H = PAD.t + PAD.b + rowH * state.frames.length;
  const { ctx, w, h } = setupCanvas(cv, H);
  const plotW = w - PAD.l - PAD.r;
  const cw = plotW / sw.vals.length;
  ctx.font = '11px sans-serif';
  state.frames.forEach((f, i) => {
    const y = PAD.t + i * rowH;
    ctx.fillStyle = '#cbd5e1'; ctx.textBaseline = 'middle';
    ctx.fillText(`#${i + 1} ${truncate(f.name, 16)}${f.label ? ' [' + labelShort(f.label) + ']' : ''}`, 6, y + rowH / 2);
    sw.rows.forEach((r, k) => {
      ctx.fillStyle = STATUS_META[r.statuses[i]].color;
      ctx.fillRect(PAD.l + k * cw, y + 1, Math.ceil(cw), rowH - 2);
    });
  });
  ctx.textBaseline = 'alphabetic';
  xAxis(ctx, sw, w, h, plotW);
}
function labelShort(l) { return { active: '活動', dead: '無位移', none: '無' }[l] || l; }

function drawLines(sw) {
  const cv = $('line_canvas');
  const { ctx, w, h } = setupCanvas(cv, 300);
  const plotW = w - PAD.l - PAD.r, plotH = h - PAD.t - PAD.b;
  const n = sw.vals.length, N = state.frames.length;
  // 網格
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 1; ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif';
  for (let g = 0; g <= 4; g++) {
    const y = PAD.t + plotH * (1 - g / 4);
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
    ctx.fillText((g * 25) + '%', PAD.l - 34, y + 4);
  }
  const X = (k) => PAD.l + (k + 0.5) * plotW / n;
  const Y = (v) => PAD.t + plotH * (1 - v);
  const series = STATUS_ORDER.map((s) => ({
    name: STATUS_META[s].text + ' 的比例', color: STATUS_META[s].color, dash: [], vals: sw.rows.map((r) => r.counts[s] / N),
  }));
  if (sw.rows.some((r) => r.score.accuracy != null)) {
    series.push({ name: '準確率', color: '#f8fafc', dash: [], width: 3, vals: sw.rows.map((r) => r.score.accuracy) });
    series.push({ name: '偵出率', color: '#38bdf8', dash: [6, 3], width: 2, vals: sw.rows.map((r) => r.score.sensitivity) });
    series.push({ name: '特異度', color: '#eab308', dash: [2, 3], width: 2, vals: sw.rows.map((r) => r.score.specificity) });
  }
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.5; ctx.setLineDash(s.dash);
    ctx.beginPath();
    let started = false;
    s.vals.forEach((v, k) => {
      if (v == null) { started = false; return; }
      if (!started) { ctx.moveTo(X(k), Y(v)); started = true; } else ctx.lineTo(X(k), Y(v));
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // 圖例
  let lx = 8, ly = PAD.t + 6;
  ctx.font = '11px sans-serif';
  for (const s of series) {
    ctx.fillStyle = s.color; ctx.fillRect(lx, ly - 7, 10, 3);
    ctx.fillStyle = '#cbd5e1'; ctx.fillText(s.name, lx + 14, ly);
    ly += 15;
  }
  xAxis(ctx, sw, w, h, plotW);
}

// ---------------------------------------------------------------------
// 雙參數熱圖
// ---------------------------------------------------------------------
function metricOf(statuses, labels, metric) {
  if (metric === 'accuracy' || metric === 'sensitivity' || metric === 'specificity') {
    return scoreAgainstLabels(statuses, labels)[metric];
  }
  const N = statuses.length;
  if (metric === 'pct_ant') return statuses.filter((s) => s === STATUS.ACTIVE || s === STATUS.DEAD).length / N;
  if (metric === 'pct_active') return statuses.filter((s) => s === STATUS.ACTIVE).length / N;
  if (metric === 'pct_dead') return statuses.filter((s) => s === STATUS.DEAD).length / N;
  return null;
}

function runSweep2() {
  if (!state.frames.length) return alert('請先上傳影像或載入示範圖組');
  const X = readRange('sw2x'), Yr = readRange('sw2y');
  if (X.key === Yr.key) return alert('X、Y 軸請選不同參數');
  if (!X.vals.length || !Yr.vals.length) return alert('掃描範圍不正確');
  if (X.vals.length * Yr.vals.length > 40000) return alert('格子太多，請加大間隔（上限 40000 格）');
  const metric = $('sw2_metric').value;
  const labels = state.frames.map((f) => f.label);
  if (metric.startsWith('acc') || metric.startsWith('sens') || metric.startsWith('spec')) {
    if (!labels.some(Boolean)) return alert('這個指標需要先在表格的「人工標註」欄標出至少一張');
  }
  const grid = Yr.vals.map((yv) => X.vals.map((xv) => {
    const p = { ...state.params, [X.key]: xv, [Yr.key]: yv };
    const statuses = state.frames.map((f, i) => evaluate(f.stats, state.diffs[i], p).status);
    return metricOf(statuses, labels, metric);
  }));
  state.sweep2 = { X, Y: Yr, grid, metric };
  $('btn_csv2').disabled = false;
  drawHeat();
}

function heatColor(v) {
  if (v == null) return '#334155';
  // 深藍 → 青 → 黃
  const stops = [[15, 23, 42], [2, 132, 199], [34, 197, 94], [234, 179, 8]];
  const t = Math.max(0, Math.min(1, v)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  const c = stops[i].map((a, j) => Math.round(a + (stops[i + 1][j] - a) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const HPAD = { l: 70, r: 70, t: 14, b: 44 };
function drawHeat() {
  const s = state.sweep2;
  if (!s) return;
  const cv = $('heat_canvas');
  const { ctx, w, h } = setupCanvas(cv, 420);
  const pw = w - HPAD.l - HPAD.r, ph = h - HPAD.t - HPAD.b;
  const nx = s.X.vals.length, ny = s.Y.vals.length;
  const cw = pw / nx, ch = ph / ny;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    ctx.fillStyle = heatColor(s.grid[j][i]);
    ctx.fillRect(HPAD.l + i * cw, HPAD.t + (ny - 1 - j) * ch, Math.ceil(cw), Math.ceil(ch));
  }
  ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  for (let t = 0; t < Math.min(8, nx); t++) {
    const k = Math.round(t * (nx - 1) / Math.max(1, Math.min(8, nx) - 1));
    ctx.fillText(String(s.X.vals[k]), HPAD.l + (k + 0.5) * cw, h - HPAD.b + 14);
  }
  ctx.fillText(SWEEPABLE[s.X.key].label + ' (' + s.X.key + ')', HPAD.l + pw / 2, h - 8);
  ctx.textAlign = 'right';
  for (let t = 0; t < Math.min(8, ny); t++) {
    const k = Math.round(t * (ny - 1) / Math.max(1, Math.min(8, ny) - 1));
    ctx.fillText(String(s.Y.vals[k]), HPAD.l - 6, HPAD.t + (ny - 1 - k + 0.5) * ch + 4);
  }
  ctx.save(); ctx.translate(14, HPAD.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
  ctx.fillText(SWEEPABLE[s.Y.key].label, 0, 0); ctx.restore();
  // 目前參數位置
  const ix = nearestIndex(s.X.vals, state.params[s.X.key]);
  const iy = nearestIndex(s.Y.vals, state.params[s.Y.key]);
  if (ix >= 0 && iy >= 0) {
    ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 2;
    ctx.strokeRect(HPAD.l + ix * cw, HPAD.t + (ny - 1 - iy) * ch, Math.max(cw, 4), Math.max(ch, 4));
  }
  // 色階
  const lx = w - HPAD.r + 20;
  for (let k = 0; k < ph; k++) {
    ctx.fillStyle = heatColor(1 - k / ph); ctx.fillRect(lx, HPAD.t + k, 14, 1);
  }
  ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'left';
  ctx.fillText('100%', lx - 2, HPAD.t - 2 + 10); ctx.fillText('0%', lx, HPAD.t + ph + 12);
  ctx.textAlign = 'left';
  $('heat_tip').innerHTML = `白框 = 目前參數。滑鼠移到格子上可看數值。`;
}

function heatHover(e) {
  const s = state.sweep2;
  if (!s) return;
  const cv = $('heat_canvas');
  const rect = cv.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const pw = rect.width - HPAD.l - HPAD.r, ph = rect.height - HPAD.t - HPAD.b;
  const i = Math.floor((x - HPAD.l) / (pw / s.X.vals.length));
  const jr = Math.floor((y - HPAD.t) / (ph / s.Y.vals.length));
  const j = s.Y.vals.length - 1 - jr;
  if (i < 0 || j < 0 || i >= s.X.vals.length || j >= s.Y.vals.length) return;
  $('heat_tip').innerHTML = `${s.X.key} = <b>${s.X.vals[i]}</b>，${s.Y.key} = <b>${s.Y.vals[j]}</b> → ${$('sw2_metric').selectedOptions[0].text.split('（')[0]}：<b>${pct(s.grid[j][i])}</b>
    <span class="hint">（點一下套用到 ② 參數）</span>`;
}
function heatClick(e) {
  const s = state.sweep2;
  if (!s) return;
  const rect = $('heat_canvas').getBoundingClientRect();
  const pw = rect.width - HPAD.l - HPAD.r, ph = rect.height - HPAD.t - HPAD.b;
  const i = Math.floor((e.clientX - rect.left - HPAD.l) / (pw / s.X.vals.length));
  const j = s.Y.vals.length - 1 - Math.floor((e.clientY - rect.top - HPAD.t) / (ph / s.Y.vals.length));
  if (i < 0 || j < 0 || i >= s.X.vals.length || j >= s.Y.vals.length) return;
  state.params[s.X.key] = s.X.vals[i];
  state.params[s.Y.key] = s.Y.vals[j];
  syncParamUI(); refresh();
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------
function downloadCsv(name, rows) {
  const csv = '\ufeff' + rows.map((r) => r.map((c) => {
    const s = c == null ? '' : String(c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function csv1() {
  const sw = state.sweep1;
  const fixed = Object.entries(state.params).filter(([k]) => k !== sw.key).map(([k, v]) => `${k}=${v}`).join(' ');
  const head = [sw.key, ...STATUS_ORDER.map((s) => 'count_' + s), 'accuracy', 'sensitivity', 'specificity',
    ...state.frames.map((f, i) => `#${i + 1} ${f.name}`)];
  const rows = [['# fixed: ' + fixed], head];
  for (const r of sw.rows) {
    rows.push([r.value, ...STATUS_ORDER.map((s) => r.counts[s]), r.score.accuracy, r.score.sensitivity, r.score.specificity, ...r.statuses]);
  }
  // 每張影像的原始數值
  rows.push([]);
  rows.push(['image', 'width', 'height', 'avgDiff', 'label']);
  state.frames.forEach((f, i) => rows.push([f.name, f.width, f.height, state.diffs[i], f.label]));
  downloadCsv(`sweep_${sw.key}.csv`, rows);
}

function csv2() {
  const s = state.sweep2;
  const rows = [[`# metric: ${s.metric}`], [`${s.Y.key} \\ ${s.X.key}`, ...s.X.vals]];
  s.Y.vals.forEach((yv, j) => rows.push([yv, ...s.grid[j]]));
  downloadCsv(`heatmap_${s.X.key}_${s.Y.key}_${s.metric}.csv`, rows);
}

// ---------------------------------------------------------------------
// 總刷新
// ---------------------------------------------------------------------
function refresh() {
  renderTable();
  renderPreview();
  if (state.sweep1) renderSweep1();
  if (state.sweep2) drawHeat();
}

// ---------------------------------------------------------------------
// 事件
// ---------------------------------------------------------------------
function init() {
  buildParams();
  fillParamSelect($('sw1_param'), 'darkThreshold'); presetRange('sw1', 'darkThreshold');
  fillParamSelect($('sw2x_param'), 'darkThreshold'); presetRange('sw2x', 'darkThreshold');
  fillParamSelect($('sw2y_param'), 'motionThreshold'); presetRange('sw2y', 'motionThreshold');
  $('sw2x_step').value = 4; $('sw2y_step').value = 0.25;
  $('sw1_param').onchange = (e) => presetRange('sw1', e.target.value);
  $('sw2x_param').onchange = (e) => presetRange('sw2x', e.target.value);
  $('sw2y_param').onchange = (e) => presetRange('sw2y', e.target.value);

  $('file_input').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  const dz = $('drop_zone');
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); addFiles(e.dataTransfer.files); };
  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) addFiles(files.map((f, i) => new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type })));
  });

  $('btn_demo').onclick = async () => {
    $('btn_demo').disabled = true;
    const { files, labels } = await makeDemoFrames();
    await addFiles(files, labels);
    $('btn_demo').disabled = false;
  };
  $('btn_clear').onclick = () => {
    state.frames.forEach((f) => URL.revokeObjectURL(f.url));
    state.frames = []; state.diffs = []; state.selected = -1; state.sweep1 = null; state.sweep2 = null;
    $('btn_csv1').disabled = true; $('btn_csv2').disabled = true;
    $('sweep1_summary').innerHTML = '';
    for (const id of ['strip_canvas', 'line_canvas', 'heat_canvas']) { const c = $(id); c.getContext('2d').clearRect(0, 0, c.width, c.height); }
    refresh();
  };
  $('resize_mode').onchange = () => { state.sweep1 = null; state.sweep2 = null; reprocessAll(); };
  $('btn_reset').onclick = () => { state.params = { ...STUDENT_DEFAULTS }; syncParamUI(); recomputeStats(); };
  $('show_mask').onchange = renderPreview;
  $('show_box').onchange = renderPreview;

  $('img_table_wrap').addEventListener('change', (e) => {
    const i = e.target.dataset.label;
    if (i == null) return;
    state.frames[+i].label = e.target.value;
    refresh();
  });
  $('img_table_wrap').addEventListener('click', (e) => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    state.selected = +tr.dataset.i;
    renderTable(); renderPreview();
  });

  for (const t of document.querySelectorAll('.tab')) {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('hidden', p.id !== t.dataset.tab));
      if (t.dataset.tab === 't2d' && state.sweep2) drawHeat();
      if (t.dataset.tab === 't1d' && state.sweep1) renderSweep1();
    };
  }
  $('btn_sweep1').onclick = runSweep1;
  $('btn_sweep2').onclick = runSweep2;
  $('btn_csv1').onclick = csv1;
  $('btn_csv2').onclick = csv2;
  $('heat_canvas').onmousemove = heatHover;
  $('heat_canvas').onclick = heatClick;

  $('legend1').innerHTML = STATUS_ORDER.map((s) => `<span><i style="background:${STATUS_META[s].color}"></i>${STATUS_META[s].text}</span>`).join('');
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(refresh, 150); });
  refresh();
}

init();
