// 量化折叠态悬浮按钮遮挡的元素（临时诊断）
const http = require("http"), path = require("path"), os = require("os");
const { spawn } = require("child_process");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9912;
const proc = spawn(EDGE, ["--headless=new", "--disable-gpu", "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + path.join(os.tmpdir(), "fo" + Date.now()), "about:blank"], { stdio: "ignore" });
const get = p => new Promise((r, j) => { http.get({ host: "127.0.0.1", port: PORT, path: p }, x => {
  let d = ""; x.on("data", c => d += c); x.on("end", () => { try { r(JSON.parse(d)); } catch (e) { j(e); } }); }).on("error", j); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PROBE = [
  "(()=>{",
  "  const R=n=>Math.round(n*10)/10;",
  "  const f=document.querySelector('.fold-float'); const fr=f.getBoundingClientRect();",
  "  const hits=[];",
  "  for(const el of document.querySelectorAll('body *')){",
  "    const r=el.getBoundingClientRect();",
  "    if(r.width<8||r.height<8||r.bottom<=0) continue;",
  "    const ox=Math.max(0,Math.min(fr.right,r.right)-Math.max(fr.left,r.left));",
  "    const oy=Math.max(0,Math.min(fr.bottom,r.bottom)-Math.max(fr.top,r.top));",
  "    if(ox>0&&oy>0&&el!==f){",
  "      const s=getComputedStyle(el);",
  "      if(s.position==='fixed') continue;",
  "      const t=(el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,16);",
  "      hits.push({t:t,area:R(ox*oy),pos:R(r.left)+','+R(r.top),cls:(el.className||'').toString().slice(0,30)});",
  "    }",
  "  }",
  "  hits.sort((a,b)=>b.area-a.area);",
  "  return JSON.stringify({btn:{l:R(fr.left),r:R(fr.right),t:R(fr.top),b:R(fr.bottom)},hits:hits.slice(0,5)});",
  "})()"
].join("\n");

(async () => {
  let list = null;
  for (let i = 0; i < 60; i++) { try { list = await get("/json/list"); if (list && list.length) break; } catch (e) {} await sleep(250); }
  const page = list.find(t => t.type === "page");
  const WebSocket = require("ws");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, pp) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pp || {} })); });
  ws.on("message", m => { const o = JSON.parse(m); if (o.id && pend.has(o.id)) { pend.get(o.id)(o.result); pend.delete(o.id); } });
  await new Promise(r => ws.on("open", r));
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const [name, url] of [["research", "http://127.0.0.1:8899/research/"], ["practice", "http://127.0.0.1:8899/practice/"]]) {
    await send("Runtime.evaluate", { expression: "try{localStorage.clear()}catch(e){}" });
    await send("Page.navigate", { url });
    await sleep(3200);
    await send("Runtime.evaluate", { expression: "document.querySelector('.nav-fold-btn').click()" });
    await sleep(1100);
    const o = await send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
    console.log("\n=====", name, "=====");
    console.log(o.result.value);
  }
  await send("Browser.close"); proc.kill(); process.exit(0);
})().catch(e => { console.error("ERR", e.message); try { proc.kill(); } catch (_) {} process.exit(1); });
