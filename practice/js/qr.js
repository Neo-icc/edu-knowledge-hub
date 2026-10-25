/* ============================================================
   极简 QR 码编码器（字节模式 / ECC M / 版本 1–10，零依赖）
   输出：{ size, matrix }（matrix 为 0/1 二维数组）
   —— 供「分享面板·微信二维码」使用；经 Python qrcode 参考实现逐位比对验证
   ============================================================ */
"use strict";

function qrEncode(text, fixedMask){
  /* ---- GF(256) ---- */
  const EXP = new Array(512), LOG = new Array(256);
  { let x = 1;
    for(let i = 0; i < 255; i++){ EXP[i] = x; LOG[x] = i; x <<= 1; if(x & 0x100) x ^= 0x11d; }
    for(let i = 255; i < 512; i++) EXP[i] = EXP[i-255]; }
  const gmul = (a,b)=> (a && b) ? EXP[LOG[a]+LOG[b]] : 0;

  /* ---- RS 生成多项式（系数按降幂排列：首元素为最高次项系数） ---- */
  function rsGen(deg){
    let g = [1];
    for(let i = 0; i < deg; i++){
      const ng = new Array(g.length+1).fill(0);
      for(let j = 0; j < g.length; j++){
        ng[j]   ^= g[j];               // 乘以 x 的部分：g[j]·x
        ng[j+1] ^= gmul(g[j], EXP[i]); // 乘以 α^i 的部分
      }
      g = ng;
    }
    return g;
  }
  function rsEncode(data, ecLen){
    const gen = rsGen(ecLen);
    const res = data.concat(new Array(ecLen).fill(0));
    for(let i = 0; i < data.length; i++){
      const f = res[i];
      if(!f) continue;
      for(let j = 0; j < gen.length; j++) res[i+j] ^= gmul(gen[j], f);
    }
    return res.slice(data.length);
  }

  /* ---- 版本与块表（ECC M） ---- */
  const CAP = [0,14,26,42,62,84,106,122,152,180,213];
  const BLOCKS = {
    1:[[26,16]], 2:[[44,28]], 3:[[70,44]], 4:[[50,32],[50,32]],
    5:[[67,43],[67,43]], 6:[[43,27],[43,27],[43,27],[43,27]],
    7:[[49,31],[49,31],[49,31],[49,31]],
    8:[[60,38],[60,38],[61,39],[61,39]],
    9:[[58,36],[58,36],[58,36],[59,37],[59,37]],
    10:[[69,43],[69,43],[69,43],[69,43],[70,44]],
  };
  const ALIGN = {
    1:[], 2:[6,18], 3:[6,22], 4:[6,26], 5:[6,30],
    6:[6,34], 7:[6,22,38], 8:[6,24,42], 9:[6,26,46], 10:[6,28,50],
  };

  let v = 10;
  const byteLen = (()=>{ let n=0;
    for(const ch of text){ const c=ch.codePointAt(0);
      n += c<0x80?1 : c<0x800?2 : 3; } return n; })();
  for(let i = 1; i <= 10; i++){ if(byteLen <= CAP[i]){ v = i; break; } }
  /* 超容量拒绝生成：截断会让二维码指向错误地址，调用方须给出降级提示 */
  if(byteLen > CAP[10]) return null;
  const size = 17 + 4*v;
  const blocks = BLOCKS[v];
  const totalData = blocks.reduce((s,b)=> s+b[1], 0);

  /* ---- 数据比特流（计数前缀为 UTF-8 字节数，非 UTF-16 长度） ---- */
  const bits = [];
  const push = (val, len)=>{ for(let i = len-1; i >= 0; i--) bits.push((val>>i)&1); };
  push(0b0100, 4);
  push(byteLen, v < 10 ? 8 : 16);
  for(const ch of text){
    const c = ch.codePointAt(0);
    if(c < 0x80) push(c, 8);
    else if(c < 0x800){ push(0xC0|(c>>6),8); push(0x80|(c&63),8); }
    else { push(0xE0|(c>>12),8); push(0x80|((c>>6)&63),8); push(0x80|(c&63),8); }
  }
  const capBits = totalData*8;
  if(bits.length < capBits){
    const t = Math.min(4, capBits-bits.length);
    for(let i = 0; i < t; i++) bits.push(0);
  }
  while(bits.length % 8) bits.push(0);
  const dataCW = [];
  for(let i = 0; i < bits.length; i += 8){
    let x = 0;
    for(let j = 0; j < 8; j++) x = (x<<1) | bits[i+j];
    dataCW.push(x);
  }
  for(let i = 0; dataCW.length < totalData; i++) dataCW.push(i%2 ? 0x11 : 0xEC);

  /* ---- 分块 + ECC + 交织 ---- */
  const dblocks = [], eblocks = [];
  let off = 0;
  for(const [tot, dc] of blocks){
    const seg = dataCW.slice(off, off+dc);
    dblocks.push(seg);
    eblocks.push(rsEncode(seg, tot-dc));
    off += dc;
  }
  const codewords = [];
  const maxD = Math.max(...dblocks.map(x=>x.length));
  for(let i = 0; i < maxD; i++) for(const db of dblocks) if(i < db.length) codewords.push(db[i]);
  const maxE = Math.max(...eblocks.map(x=>x.length));
  for(let i = 0; i < maxE; i++) for(const eb of eblocks) if(i < eb.length) codewords.push(eb[i]);

  /* ---- 矩阵与功能图形 ---- */
  const M = Array.from({length:size}, ()=> new Array(size).fill(null));
  const F = Array.from({length:size}, ()=> new Array(size).fill(false));
  const setF = (r,c,val)=>{ if(r>=0&&c>=0&&r<size&&c<size){ M[r][c]=val; F[r][c]=true; } };

  for(const [fr,fc] of [[0,0],[0,size-7],[size-7,0]]){
    for(let i = -1; i <= 7; i++) for(let j = -1; j <= 7; j++){
      const rr = fr+i, cc = fc+j;
      if(rr<0||cc<0||rr>=size||cc>=size) continue;
      const inF = i>=0 && i<=6 && j>=0 && j<=6;
      const ring = inF && (i===0||i===6||j===0||j===6);
      const core = i>=2 && i<=4 && j>=2 && j<=4;
      setF(rr, cc, (ring||core) ? 1 : 0);
    }
  }
  for(let i = 8; i < size-8; i++){ setF(6,i,(i%2===0)?1:0); setF(i,6,(i%2===0)?1:0); }
  for(const r of ALIGN[v]) for(const c of ALIGN[v]){
    if((r<=8&&c<=8)||(r<=8&&c>=size-9)||(r>=size-9&&c<=8)) continue;
    for(let i = -2; i <= 2; i++) for(let j = -2; j <= 2; j++){
      const d = Math.max(Math.abs(i),Math.abs(j));
      setF(r+i, c+j, d===2 ? 1 : (d===1 ? 0 : 1));
    }
  }
  setF(size-8, 8, 1);
  /* 格式信息区 + 版本信息区必须预标记为功能区，否则之字形数据放置会占用这些格子 */
  for(let i = 0; i < 15; i++){
    let r;
    if(i < 6) r = i;
    else if(i < 8) r = i + 1;
    else r = size - 15 + i;
    setF(r, 8, 0);
  }
  for(let i = 0; i < 15; i++){
    let c;
    if(i < 8) c = size - 1 - i;
    else if(i < 9) c = 7;
    else c = 14 - i;
    setF(8, c, 0);
  }
  if(v >= 7){
    for(let i = 0; i < 18; i++){
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setF(a, b, 0);
      setF(b, a, 0);
    }
  }

  /* ---- 数据放置（之字形，跳过 timing 列） ---- */
  const totalBits = codewords.length*8;
  let bitPos = 0;
  for(let col = size-1; col > 0; col -= 2){
    if(col === 6) col--;
    for(let k = 0; k < size; k++){
      const r = (Math.floor((size-1-col)/2)%2===0) ? size-1-k : k;
      for(let dc = 0; dc < 2; dc++){
        const c = col-dc;
        if(F[r][c]) continue;
        const bit = bitPos < totalBits ? ((codewords[bitPos>>3] >> (7-(bitPos&7)))&1) : 0;
        M[r][c] = bit; bitPos++;
      }
    }
  }

  /* ---- 掩码（8 选 1，按惩罚分） ---- */
  function penalty(mat){
    let p = 0;
    const rowRuns = (arr)=>{ let run=1;
      for(let i=1;i<=arr.length;i++){
        if(i<arr.length && arr[i]===arr[i-1]) run++;
        else { if(run>=5) p += run-2; run=1; } } };
    for(let r=0;r<size;r++) rowRuns(mat[r]);
    for(let c=0;c<size;c++){ const colA=[]; for(let r=0;r<size;r++) colA.push(mat[r][c]); rowRuns(colA); }
    for(let r=0;r<size-1;r++) for(let c=0;c<size-1;c++)
      if(mat[r][c]===mat[r][c+1]&&mat[r][c]===mat[r+1][c]&&mat[r][c]===mat[r+1][c+1]) p+=3;
    const seq = a=> a[0]&&!a[1]&&a[2]&&a[3]&&a[4]&&!a[5]&&a[6];
    for(let r=0;r<size;r++){
      for(let c=0;c<size-10;c++){
        const a=mat[r].slice(c,c+11);
        if(seq(a)&&!a.slice(7).some(Boolean)) p+=40;
        if(!a.slice(0,4).some(Boolean)&&seq(a.slice(4))) p+=40;
        if(mat[r][c+10]) c++;   // 与参考一致的跳跃：c+10 为暗时跳过下一次
      }
    }
    for(let c=0;c<size;c++){
      for(let r=0;r<size-10;r++){
        const a=[]; for(let i=0;i<11;i++) a.push(mat[r+i][c]);
        if(seq(a)&&!a.slice(7).some(Boolean)) p+=40;
        if(!a.slice(0,4).some(Boolean)&&seq(a.slice(4))) p+=40;
        if(mat[r+10][c]) r++;
      }
    }
    let dark=0; for(const row of mat) for(const x of row) if(x) dark++;
    p += Math.floor(Math.abs(dark/(size*size)*100 - 50)/5)*10;
    return p;
  }
  const maskFn = [
    (i,j)=> (i+j)%2===0, (i,j)=> i%2===0, (i,j)=> j%3===0, (i,j)=> (i+j)%3===0,
    (i,j)=> (Math.floor(i/2)+Math.floor(j/3))%2===0,
    (i,j)=> (i*j)%2+(i*j)%3===0, (i,j)=> ((i*j)%2+(i*j)%3)%2===0,
    (i,j)=> ((i+j)%2+(i*j)%3)%2===0,
  ];

  /* ---- 格式信息（ECC M=00 + 掩码），BCH(15,5) ---- */
  function fmtBits(data5){
    let d = data5 << 10;
    for(let i = 14; i >= 10; i--) if(d & (1<<i)) d ^= 0x537 << (i-10);
    return ((data5<<10) | d) ^ 0x5412;
  }
  function placeFormat(mat, mask){
    const fmt = fmtBits((0b00 << 3) | mask);
    const fb = i => (fmt >> i) & 1;
    for(let i = 0; i < 15; i++){
      let r;
      if(i < 6) r = i;
      else if(i < 8) r = i + 1;
      else r = size - 15 + i;
      mat[r][8] = fb(i);
    }
    for(let i = 0; i < 15; i++){
      let c;
      if(i < 8) c = size - 1 - i;
      else if(i < 9) c = 7;
      else c = 14 - i;
      mat[8][c] = fb(i);
    }
    mat[size-8][8] = 1;
  }

  /* ---- 版本信息（v>=7），BCH(18,6) ---- */
  let verInfo = 0;
  if(v >= 7){
    let d = v << 12;
    for(let i = 17; i >= 12; i--) if(d & (1<<i)) d ^= 0x1F25 << (i-12);
    verInfo = (v<<12) | d;
  }
  function placeVersion(mat){
    if(!verInfo) return;
    for(let i = 0; i < 18; i++){
      const bit = (verInfo >> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mat[a][b] = bit;
      mat[b][a] = bit;
    }
  }

  let bestMask = 0, bestP = Infinity, bestMat = null;
  for(let m = 0; m < 8; m++){
    const t = M.map(row=>row.slice());
    for(let i=0;i<size;i++) for(let j=0;j<size;j++)
      if(!F[i][j]) t[i][j] ^= maskFn[m](i,j) ? 1 : 0;
    /* 与参考实现一致：选掩码时格式/版本位保持空白（全亮），选定后再写入 */
    const pf = penalty(t);
    if(pf < bestP){ bestP = pf; bestMask = m; bestMat = t; }
  }
  /* 选定掩码后写入真实格式位与版本位 */
  placeFormat(bestMat, bestMask);
  placeVersion(bestMat);
  /* 调试用：强制固定掩码（仅测试传参，生产走自动选择） */
  if(typeof fixedMask === "number" && fixedMask >= 0 && fixedMask < 8){
    const t = M.map(row=>row.slice());
    for(let i=0;i<size;i++) for(let j=0;j<size;j++)
      if(!F[i][j]) t[i][j] ^= maskFn[fixedMask](i,j) ? 1 : 0;
    placeFormat(t, fixedMask);
    placeVersion(t);
    bestMask = fixedMask; bestMat = t;
  }

  return { size, matrix: bestMat, version: v, mask: bestMask };
}

if(typeof module !== "undefined" && module.exports){ module.exports = { qrEncode }; }
