// =====================================================================
// 學生演算法（參數化版）
//
// 計算步驟與學生原版 runAIModel() 完全相同，只把寫死的常數抽成參數：
//   65    → darkThreshold   暗像素灰階閾值（gray < 此值算暗）
//   0.015 → ratioMin        暗像素比例下限（ratio > 此值才可能是螞蟻）
//   0.25  → ratioMax        暗像素比例上限（ratio >= 此值視為陰影/雜物）
//   1.0   → motionThreshold 平均灰階差（avgDiff > 此值算「有在動」）
//   0.299/0.587/0.114 → wR/wG/wB 灰階權重
//
// 原版逐字程式碼留在 original/student_algorithm.js，
// test/parity.test.mjs 會比對兩者在預設參數下輸出一致。
// 這個檔案不碰 DOM，瀏覽器與 Node 都能用。
// =====================================================================

export const STUDENT_DEFAULTS = Object.freeze({
  darkThreshold: 65,
  ratioMin: 0.015,
  ratioMax: 0.25,
  motionThreshold: 1.0,
  wR: 0.299,
  wG: 0.587,
  wB: 0.114,
});

export const STATUS = Object.freeze({
  ACTIVE: 'active',   // 學生：🐜 發現琉璃蟻群體活動中
  DEAD: 'dead',       // 學生：☠️ 琉璃蟻群聚無位移 (中毒現象)
  CLUTTER: 'clutter', // 學生：antStatus='none'，但文字顯示「⚠️ 偵測到大面積陰影或雜物」
  NONE: 'none',       // 學生：✅ 目前區域無琉璃蟻
});

/**
 * 學生的逐像素迴圈：算灰階、暗像素數。
 * 另外順便建一個灰階直方圖（hist[floor(gray)]），讓敏感度掃描不必重跑整張圖。
 * 對「整數」閾值 T：gray < T  ⇔  floor(gray) < T，所以直方圖結果與逐像素比較完全一致。
 */
export function computeGrayStats(data, width, height, params) {
  const { wR, wG, wB, darkThreshold } = params;
  let darkPixels = 0;
  const currentGray = new Uint8Array(width * height); // 與學生相同：存入時被截成 0~255 整數
  const hist = new Uint32Array(257);
  let idx = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = wR * data[i] + wG * data[i + 1] + wB * data[i + 2];
    currentGray[idx++] = gray;
    if (gray < darkThreshold) { darkPixels++; }
    let b = Math.floor(gray);
    if (b < 0) b = 0; else if (b > 256) b = 256;
    hist[b]++;
  }
  return { currentGray, hist, darkPixels, total: width * height, width, height };
}

/** 用直方圖算「gray < T」的像素數（T 會被取整數）。 */
export function darkCountFromHist(hist, threshold) {
  const t = Math.max(0, Math.min(257, Math.round(threshold)));
  let c = 0;
  for (let b = 0; b < t; b++) c += hist[b];
  return c;
}

/**
 * 學生的移動量：前後兩張灰階逐像素差的絕對值平均。
 * 與原版相同：沒有前一張、或像素數不同時 diffSum = 0 → avgDiff = 0。
 */
export function meanAbsDiff(currentGray, prevGrayData) {
  let diffSum = 0;
  if (prevGrayData && prevGrayData.length === currentGray.length) {
    for (let i = 0; i < currentGray.length; i++) {
      diffSum += Math.abs(currentGray[i] - prevGrayData[i]);
    }
  }
  return diffSum / currentGray.length;
}

/** 學生的判斷規則（if/else 結構原樣保留）。 */
export function classify(ratio, avgDiff, params) {
  if (ratio > params.ratioMin && ratio < params.ratioMax) {
    if (avgDiff > params.motionThreshold) {
      return STATUS.ACTIVE;
    } else {
      return STATUS.DEAD;
    }
  } else {
    return ratio >= params.ratioMax ? STATUS.CLUTTER : STATUS.NONE;
  }
}

/** 學生程式內部的 antStatus（雜物也算 'none'）。 */
export function toAntStatus(status) {
  return status === STATUS.CLUTTER ? STATUS.NONE : status;
}

/** 學生的 updateDynamicRatio()：誘餌配方建議。 */
export function baitAdvice(status) {
  const antStatus = toAntStatus(status);
  let borax = 10, sugar = 30, water = 60;
  let advice = '';
  let danmaku = null;
  if (antStatus === 'active') {
    borax += 2; sugar += 5; water -= 7;
    advice += '⚠️ 偵測到大量琉璃蟻出沒！建議加強糖液誘引劑濃度以提高攝食量。';
    danmaku = { text: '⚠️ 警告：發現大批琉璃蟻出沒覓食！', color: '#f43f5e' };
  } else if (antStatus === 'dead') {
    borax -= 2; sugar += 2; water += 5;
    advice += '☠️ 琉璃蟻群聚但活動停滯！可能已接觸硼砂毒餌，中毒成效顯著。';
    danmaku = { text: '☠️ 琉璃蟻群聚無位移 (硼砂中毒反應)', color: '#a855f7' };
  } else {
    advice += '✨ 目前無顯著琉璃蟻活動，維持周邊預防性布餌。';
  }
  return { borax, sugar, water, advice, danmaku };
}

/**
 * 依序分析多張影像（模擬學生每 2.5 秒跑一次 runAIModel 的連續畫面）。
 * frames[i] 需有 currentGray、hist、darkPixels、total。
 * 第 i 張的 avgDiff 是跟第 i-1 張比；第一張沒有前一張 → 0（與學生剛開網頁時相同）。
 */
export function computeDiffs(frames) {
  const out = [];
  let prev = null;
  for (const f of frames) {
    out.push(meanAbsDiff(f.currentGray, prev));
    prev = f.currentGray;
  }
  return out;
}

/** 單張評估：用直方圖快速算，給敏感度掃描用。 */
export function evaluate(frame, avgDiff, params) {
  const darkPixels = darkCountFromHist(frame.hist, params.darkThreshold);
  const ratio = darkPixels / frame.total;
  return { ratio, avgDiff, darkPixels, status: classify(ratio, avgDiff, params) };
}

/**
 * 跟人工標註比對。
 * 標註值：'active' | 'dead' | 'none' | ''（未標註）
 * 預測的 'clutter' 視同 'none'（學生程式也是這樣）。
 */
export function scoreAgainstLabels(predictions, labels) {
  let n = 0, correct = 0;
  let antTotal = 0, antHit = 0;     // 有螞蟻（active/dead）→ 是否有判成有螞蟻
  let noneTotal = 0, noneHit = 0;   // 沒螞蟻 → 是否判成沒螞蟻
  for (let i = 0; i < predictions.length; i++) {
    const truth = labels[i];
    if (!truth) continue;
    const pred = toAntStatus(predictions[i]);
    n++;
    if (pred === truth) correct++;
    const predAnt = pred === 'active' || pred === 'dead';
    if (truth === 'none') { noneTotal++; if (!predAnt) noneHit++; }
    else { antTotal++; if (predAnt) antHit++; }
  }
  return {
    labeled: n,
    accuracy: n ? correct / n : null,
    sensitivity: antTotal ? antHit / antTotal : null,   // 偵出率（真陽性率）
    specificity: noneTotal ? noneHit / noneTotal : null, // 特異度（真陰性率）
  };
}

export const SWEEPABLE = Object.freeze({
  darkThreshold: { label: '暗像素閾值', min: 0, max: 255, step: 1, integer: true },
  ratioMin: { label: '比例下限', min: 0, max: 1, step: 0.001 },
  ratioMax: { label: '比例上限', min: 0, max: 1, step: 0.01 },
  motionThreshold: { label: '移動量閾值', min: 0, max: 50, step: 0.1 },
});

/** 產生掃描值清單（避免浮點累加誤差）。 */
export function rangeValues(start, end, step, integer = false, limit = 500) {
  const vals = [];
  if (!(step > 0) || !isFinite(start) || !isFinite(end)) return vals;
  const n = Math.floor((end - start) / step + 1e-9);
  for (let k = 0; k <= n && vals.length < limit; k++) {
    let v = start + k * step;
    v = integer ? Math.round(v) : Number(v.toFixed(6));
    if (!vals.length || vals[vals.length - 1] !== v) vals.push(v);
  }
  return vals;
}
