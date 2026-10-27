// 诊断裸域 CDN 通道：HTML 缓存头、引用的 bundle 是否 404
const http = require("http");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const TARGET = process.argv[2] || "https://epck.space/practice/";
const PORT = 9810 + Math.floor(Math.random() * 20);

const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", "--no-proxy-server",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + path.join(os.tmpdir(), "edge-cdn-" + Date.now()),
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

  const rows = [], fails = [];
  ws.on("message", m => {
    const msg = JSON.parse(m);
    if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg.result); pend.delete(msg.id); return; }
    if (msg.method === "Network.responseReceived") {
      const r = msg.params.response;
      if (/practice|bundle-/.test(r.url)) {
        rows.push({
          url: r.url.replace(/^https?:\/\/[^/]+/, ""),
          status: r.status,
          cc: r.headers["cache-control"] || r.headers["Cache-Control"] || "-",
          age: r.headers["age"] || r.headers["Age"] || "-",
          cache: r.headers["x-cache"] || r.headers["x-cache-lookup"] || r.headers["x-nws-log-uuid"] ? (r.headers["x-cache"] || "-") : "-",
          server: r.headers["server"] || "-",
        });
      }
    }
    if (msg.method === "Network.loadingFailed") fails.push(msg.params.errorText + " " + (msg.params.blockedReason || ""));
  });

  await new Promise(r => ws.on("open", r));
  await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: TARGET });
  await sleep(6000);

  const info = await send("Runtime.evaluate", {
    expression: `(()=>{
      const res={title:document.title, bodyLen:(document.body.innerText||'').length};
      const s=[...document.querySelectorAll('script[src]')].map(e=>e.getAttribute('src'));
      res.scripts=s;
      res.cards=document.querySelectorAll('.sc-card').length;
      res.pageTitle=(document.querySelector('.page-title')||{}).textContent||'';
      return JSON.stringify(res);
    })()`,
    returnByValue: true,
  });

  console.log("=== 页面 ===");
  console.log(info.result.value);
  console.log("\n=== 资源与缓存头 ===");
  rows.forEach(r => console.log(`  ${String(r.status).padEnd(4)} ${r.url.padEnd(38)} cc=${String(r.cc).slice(0,42).padEnd(42)} age=${r.age} server=${r.server}`));
  if (fails.length) { console.log("\n=== 加载失败 ==="); fails.slice(0, 6).forEach(f => console.log("  " + f)); }

  await send("Browser.close");
  proc.kill();
  process.exit(0);
})().catch(e => { console.error("ERR", e.message); try { proc.kill(); } catch (_) {} process.exit(1); });
