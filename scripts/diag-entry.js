// 诊断：从 hub 点进「家长与老师」入口后，iframe 是否真的渲染出内容
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const TARGET = process.argv[2] || "https://www.epck.space/";
const PORT = 9780 + Math.floor(Math.random() * 20);

const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + path.join(os.tmpdir(), "edge-diag-" + Date.now()),
  "--window-size=1440,900", "about:blank",
], { stdio: "ignore" });

const get = p => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, r => {
    let d = ""; r.on("data", c => d += c); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on("error", rej);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let list = null;
  for (let i = 0; i < 80; i++) {
    try { list = await get("/json/list"); if (list && list.length) break; } catch (e) {}
    await sleep(250);
  }
  const page = list.find(t => t.type === "page");
  const WebSocket = require("ws");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise(res => {
    const i = ++id; pend.set(i, res);
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });

  const consoleErrs = [], netFails = [];
  ws.on("message", m => {
    const msg = JSON.parse(m);
    if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg.result); pend.delete(msg.id); return; }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrs.push((msg.params.args || []).map(a => a.value || a.description || "").join(" ").slice(0, 160));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrs.push("EXC: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text || "").slice(0, 160));
    }
    if (msg.method === "Network.responseReceived") {
      const r = msg.params.response;
      if (r.status >= 400) netFails.push(r.status + " " + r.url.slice(-70));
    }
    if (msg.method === "Network.loadingFailed") {
      netFails.push("FAIL " + (msg.params.errorText || "") + " " + (msg.params.blockedReason || ""));
    }
  });

  await new Promise(r => ws.on("open", r));
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Page.navigate", { url: TARGET });
  await sleep(3500);

  // 点进家长与老师
  await send("Runtime.evaluate", {
    expression: `(()=>{const b=document.querySelector('[data-ident="parent"]')||document.querySelector('.ident');if(b){b.click();return 'clicked'}return 'no button'})()`,
    returnByValue: true,
  });
  await sleep(14000);

  const out = await send("Runtime.evaluate", {
    expression: `(()=>{
      const f=document.getElementById('frame');
      const wrap=document.getElementById('frameWrap');
      const res={src:f?f.getAttribute('src'):null,
        wrapHidden: wrap?wrap.hasAttribute('hidden'):null,
        wrapDisp: wrap?getComputedStyle(wrap).display:null};
      try{
        const d=f.contentDocument;
        res.accessible=!!d;
        if(d){
          res.docH=d.documentElement.scrollHeight;
          res.bodyLen=(d.body.innerText||'').length;
          res.head=d.title;
          res.cards=d.querySelectorAll('.sc-card').length;
          res.chips=d.querySelectorAll('.chip').length;
          res.sidebar=d.querySelectorAll('.nav-group, .side-group, aside a').length;
          res.firstText=(d.querySelector('.page-title')||{}).textContent||'';
          res.scripts=[...d.querySelectorAll('script[src]')].map(s=>s.getAttribute('src'));
          res.bodyClass=d.body.className;
        }
      }catch(e){ res.err=e.message; }
      return JSON.stringify(res);
    })()`,
    returnByValue: true,
  });

  console.log("=== iframe 状态 ===");
  console.log(out.result.value);
  console.log("=== 控制台错误 ===");
  console.log(consoleErrs.length ? consoleErrs.slice(0, 8).join("\n") : "(无)");
  console.log("=== 失败请求 ===");
  console.log(netFails.length ? netFails.slice(0, 12).join("\n") : "(无)");

  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(__dirname, "_diag-entry.png"), Buffer.from(shot.data, "base64"));
  console.log("截图已存 _diag-entry.png");

  await send("Browser.close");
  proc.kill();
  process.exit(0);
})().catch(e => { console.error("ERR", e.message); try { proc.kill(); } catch (_) {} process.exit(1); });
