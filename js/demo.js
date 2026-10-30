// 示範圖組：用程式畫出來的「合成」畫面，只用來試操作流程，不代表真實拍攝結果。
// 8 張連續畫面（800×600，接近 ESP32 SVGA），檔名排序即畫面順序，並附人工標註。

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const W = 800, H = 600;

function background(ctx, rand, brightness = 1) {
  const g = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 520);
  const c1 = Math.round(205 * brightness), c2 = Math.round(150 * brightness);
  g.addColorStop(0, `rgb(${c1},${c1 - 8},${c1 - 22})`);
  g.addColorStop(1, `rgb(${c2},${c2 - 8},${c2 - 20})`); // 鏡頭暗角
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 磁磚縫
  ctx.strokeStyle = `rgba(110,100,90,${0.5 * brightness})`; ctx.lineWidth = 3;
  for (let x = 200; x < W; x += 200) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 200; y < H; y += 200) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // 紋理雜訊
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 14;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function ant(ctx, x, y, angle, scale = 1) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale);
  ctx.fillStyle = 'rgb(28,22,18)';
  ctx.strokeStyle = 'rgb(40,32,26)'; ctx.lineWidth = 1.2;
  for (const s of [-1, 1]) for (const dx of [-3, 0, 3]) {
    ctx.beginPath(); ctx.moveTo(dx, 0); ctx.lineTo(dx + s * 2, s * 7); ctx.stroke();
  }
  ctx.beginPath(); ctx.ellipse(-7, 0, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill(); // 腹
  ctx.beginPath(); ctx.ellipse(0, 0, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill(); // 胸
  ctx.beginPath(); ctx.ellipse(6, 0, 3, 2.8, 0, 0, Math.PI * 2); ctx.fill();   // 頭
  ctx.restore();
}

function makeColony(seed, n, cx, cy, spread) {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({
    x: cx + (r() - 0.5) * spread, y: cy + (r() - 0.5) * spread * 0.7,
    a: r() * Math.PI * 2, s: 0.9 + r() * 0.5,
  }));
}

function toFile(canvas, name) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(new File([b], name, { type: 'image/jpeg' })), 'image/jpeg', 0.9));
}

export async function makeDemoFrames() {
  const specs = [];
  const colony = makeColony(7, 90, 420, 300, 420);

  specs.push({ name: '01_empty.jpg', label: 'none', draw: (ctx, r) => background(ctx, r) });
  specs.push({ name: '02_empty.jpg', label: 'none', draw: (ctx, r) => background(ctx, r) });
  // 螞蟻出現並移動
  for (let k = 0; k < 3; k++) {
    specs.push({
      name: `0${3 + k}_ants_moving.jpg`, label: 'active',
      draw: (ctx, r) => {
        background(ctx, r);
        for (const a of colony) ant(ctx, a.x + Math.cos(a.a) * 14 * k, a.y + Math.sin(a.a) * 14 * k, a.a, a.s);
      },
    });
  }
  // 螞蟻停住不動（兩張完全同位置）
  for (let k = 0; k < 2; k++) {
    specs.push({
      name: `0${6 + k}_ants_still.jpg`, label: 'dead',
      draw: (ctx, r) => {
        background(ctx, r);
        for (const a of colony) ant(ctx, a.x + Math.cos(a.a) * 28, a.y + Math.sin(a.a) * 28, a.a, a.s);
      },
    });
  }
  // 手擋到的大陰影，無螞蟻（暗像素約 18%，低於學生的 25% 上限 → 會被誤判成有螞蟻）
  specs.push({
    name: '08_shadow.jpg', label: 'none',
    draw: (ctx, r) => {
      background(ctx, r);
      const g = ctx.createLinearGradient(0, 0, 500, 0);
      g.addColorStop(0, 'rgba(10,10,15,0.92)'); g.addColorStop(1, 'rgba(10,10,15,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 520, H);
    },
  });

  const files = [], labels = {};
  for (let i = 0; i < specs.length; i++) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    // 背景用同一個亂數種子：鏡頭固定、場景不變時，兩張之間的差異只來自螞蟻與 JPEG 壓縮
    specs[i].draw(c.getContext('2d'), rng(1000));
    files.push(await toFile(c, 'demo_' + specs[i].name));
    labels['demo_' + specs[i].name] = specs[i].label;
  }
  return { files, labels };
}
