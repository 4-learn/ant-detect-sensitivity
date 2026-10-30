// =====================================================================
// 學生原始演算法（逐字取自 ESP32-CAM .ino 中 INDEX_HTML 的 <script>）
// 只做了「把 C 字串還原成 JS」：去掉每行外層的雙引號、\" 還原成 "。
// 邏輯、常數、變數名稱一律未改。
//
// 這個檔案「不會」被網頁載入，只給 test/parity.test.mjs 用來比對：
// 確認 js/algorithm.js 在預設參數下的結果與學生原版完全一致。
// =====================================================================

let antStatus = 'none';
let prevGrayData = null;
let captureTimer = null;

function showDanmaku(text, color='#38bdf8'){
  const box = document.getElementById('danmaku_box');
  const d = document.createElement('div');
  d.className = 'danmaku';
  d.innerText = text;
  d.style.color = color;
  d.style.top = Math.floor(Math.random() * 80) + '%';
  box.appendChild(d);
  setTimeout(() => { d.remove(); }, 6000);
}

function updateDynamicRatio(){
let borax=10, sugar=30, water=60;
let advice='';
if(antStatus === 'active'){
borax += 2; sugar += 5; water -= 7;
advice += '⚠️ 偵測到大量琉璃蟻出沒！建議加強糖液誘引劑濃度以提高攝食量。';
showDanmaku('⚠️ 警告：發現大批琉璃蟻出沒覓食！', '#f43f5e');
}else if(antStatus === 'dead'){
borax -= 2; sugar += 2; water += 5;
advice += '☠️ 琉璃蟻群聚但活動停滯！可能已接觸硼砂毒餌，中毒成效顯著。';
showDanmaku('☠️ 琉璃蟻群聚無位移 (硼砂中毒反應)', '#a855f7');
}else{
advice += '✨ 目前無顯著琉璃蟻活動，維持周邊預防性布餌。';
}
let html='<span class="ratio-highlight">💡 琉璃蟻專用誘餌建議比例：</span><br>'+
'• 硼砂 (緩效毒劑)：<b>'+borax+'%</b><br>'+
'• 糖漿/果糖 (強效誘引)：<b>'+sugar+'%</b><br>'+
'• 水份 (稀釋載體)：<b>'+water+'%</b><br><br>'+
'<small><b>AI 防治評估：</b>'+advice+'</small>';
document.getElementById('ratio_text').innerHTML=html;
}

function runAIModel(){
  const img = document.getElementById('cam_img');
  const canvas = document.getElementById('canvas');
  const overlay = document.getElementById('overlay');
  if(!img.naturalWidth || !img.naturalHeight) return;
  
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  overlay.width = img.clientWidth;
  overlay.height = img.clientHeight;
  
  const ctx = canvas.getContext('2d');
  const oCtx = overlay.getContext('2d');
  oCtx.clearRect(0, 0, overlay.width, overlay.height);

  try{
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    let darkPixels = 0;
    let currentGray = new Uint8Array(canvas.width * canvas.height);
    let idx = 0;
    for(let i=0; i<data.length; i+=4){
      let gray = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
      currentGray[idx++] = gray;
      if(gray < 65) { darkPixels++; }
    }
    let ratio = darkPixels / (canvas.width * canvas.height);
    let diffSum = 0;
    if(prevGrayData && prevGrayData.length === currentGray.length){
      for(let i=0; i<currentGray.length; i++){
        diffSum += Math.abs(currentGray[i] - prevGrayData[i]);
      }
    }
    prevGrayData = currentGray;
    let avgDiff = diffSum / currentGray.length;
    
    if(ratio > 0.015 && ratio < 0.25){
      if(avgDiff > 1.0){
        antStatus = 'active';
        document.getElementById('density_text').innerHTML='狀態: <span class="density-highlight">🤖 AI 判定：🐜 發現琉璃蟻群體活動中！</span>';
        oCtx.strokeStyle = '#f43f5e';
        oCtx.lineWidth = 2;
        oCtx.strokeRect(overlay.width * 0.3, overlay.height * 0.3, overlay.width * 0.4, overlay.height * 0.4);
      }else{
        antStatus = 'dead';
        document.getElementById('density_text').innerHTML='狀態: <span style="color:#a855f7;">🤖 AI 判定：☠️ 琉璃蟻群聚無位移 (中毒現象)</span>';
        oCtx.strokeStyle = '#a855f7';
        oCtx.lineWidth = 2;
        oCtx.strokeRect(overlay.width * 0.3, overlay.height * 0.3, overlay.width * 0.4, overlay.height * 0.4);
      }
    }else{
      antStatus = 'none';
      document.getElementById('density_text').innerHTML='狀態: ' + (ratio >= 0.25 ? '<span style="color:#f59e0b;">🤖 AI 判定：⚠️ 偵測到大面積陰影或雜物</span>' : '<span>🤖 AI 判定：✅ 目前區域無琉璃蟻</span>');
    }
    updateDynamicRatio();
  }catch(e){
    document.getElementById('density_text').innerText='AI 影像分析初始化中...';
  }
}
