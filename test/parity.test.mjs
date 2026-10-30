// 確認 js/algorithm.js（預設參數）與學生原版 runAIModel() 判定完全一致。
// 執行：node test/parity.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { STUDENT_DEFAULTS, STATUS, computeGrayStats, computeDiffs, evaluate, darkCountFromHist, rangeValues } from '../js/algorithm.js';

const src = fs.readFileSync(new URL('../original/student_algorithm.js', import.meta.url), 'utf8');

// --- 假 DOM：讓學生程式以為自己在瀏覽器裡 ---
function makeStudentSandbox() {
  const els = {};
  const el = (id) => (els[id] ||= { id, innerHTML: '', innerText: '', style: {}, appendChild() {}, width: 0, height: 0 });
  let currentData = null;
  const ctx2d = { drawImage() {}, getImageData: () => ({ data: currentData }), clearRect() {}, strokeRect() {}, strokeStyle: '', lineWidth: 0 };
  for (const id of ['canvas', 'overlay']) el(id).getContext = () => ctx2d;
  const sandbox = {
    document: { getElementById: el, createElement: () => ({ style: {}, remove() {} }) },
    setTimeout: () => 0, Math, Uint8Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\n;globalThis.__get = () => antStatus;', sandbox);
  return {
    run(data, w, h) {
      currentData = data;
      Object.assign(el('cam_img'), { naturalWidth: w, naturalHeight: h, clientWidth: w, clientHeight: h });
      sandbox.runAIModel();
      return { antStatus: sandbox.__get(), text: el('density_text').innerHTML };
    },
  };
}

function studentToStatus(r) {
  if (r.antStatus !== 'none') return r.antStatus;
  return r.text.includes('陰影') ? STATUS.CLUTTER : STATUS.NONE;
}

// --- 隨機測試影像 ---
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

function makeFrame(w, h, darkFrac, base) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    const dark = rand() < darkFrac;
    const v = dark ? Math.floor(rand() * 70) : base + Math.floor(rand() * 40) - 20;
    d[i] = v + Math.floor(rand() * 10); d[i + 1] = v; d[i + 2] = v - Math.floor(rand() * 10); d[i + 3] = 255;
  }
  return d;
}

const W = 64, H = 48;
const frames = [];
const darkFracs = [0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.24, 0.26, 0.4, 0.05, 0.05, 0.12];
for (const df of darkFracs) frames.push(makeFrame(W, H, df, 150 + Math.floor(rand() * 60)));
frames.push(frames[frames.length - 1].slice()); // 完全相同 → avgDiff 0 → dead/none
frames.push(makeFrame(W + 1, H, 0.1, 160));      // 尺寸不同 → avgDiff 0
frames.push(makeFrame(W + 1, H, 0.1, 160));

const student = makeStudentSandbox();
const studentStatuses = frames.map((d) => {
  const w = d.length / 4 / H;
  return studentToStatus(student.run(d, w, H));
});

const stats = frames.map((d) => computeGrayStats(d, d.length / 4 / H, H, STUDENT_DEFAULTS));
const diffs = computeDiffs(stats);
const ours = stats.map((s, i) => evaluate(s, diffs[i], STUDENT_DEFAULTS).status);

// 直方圖快算 == 逐像素計數
stats.forEach((s) => assert.equal(darkCountFromHist(s.hist, 65), s.darkPixels));

assert.deepEqual(ours, studentStatuses);
const kinds = new Set(ours);
for (const k of Object.values(STATUS)) assert.ok(kinds.has(k), '測試資料應涵蓋所有判定：缺 ' + k);

assert.deepEqual(rangeValues(0, 0.1, 0.02), [0, 0.02, 0.04, 0.06, 0.08, 0.1]);
assert.deepEqual(rangeValues(20, 30, 5, true), [20, 25, 30]);

console.log('PASS  與學生原版一致：', ours.join(', '));
