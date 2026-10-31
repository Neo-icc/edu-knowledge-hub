// 折叠态「展开侧栏」按钮实测：practice 与 research 各自折叠后，看按钮到底在哪、多大
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.PROBE_BASE || "http://127.0.0.1:8899/";
const PORT = 9600 + Math.floor(Math.random() * 30);

const proc = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + path.join(os.tmpdir(), "edge-probe-" + Date.now()),
  "--window-size=1440,900", "about:blank"], { stdio: "ignore" });

const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, (r) => {
    let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(JSON.parse(d)));
  }).on("error", rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  let list = null;
  for (let i = 0; i < 40 && !list; i++) { try { list = await getJSON("/json/list"); } catch (e) { await sleep(250); } }
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r) => ws.on("open", r));
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  await send("Runtime.enable"); await send("Page.enable");
  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

  const probe = (hash) => `(function(){
    var f = document.getElementById('frame');
    var d = f && f.contentDocument;
    if (!d) return 'no-frame';
    var out = { collapsed: d.body.className, items: [] };
    [' .fold-float', '.fold-float', '#fold-float', '.nav-fold-btn', '.topbar .icon-btn', '.topbar button'].forEach(function(sel){
      var els = d.querySelectorAll(sel.trim());
      els.forEach(function(el){
        var r = el.getBoundingClientRect(), s = d.defaultView.getComputedStyle(el);
        if (r.width || r.height) out.items.push(sel.trim() + ' [' + (el.id||el.className) + '] ' +
          Math.round(r.width) + 'x' + Math.round(r.height) + ' display=' + s.display + ' vis=' + s.visibility +
          ' text=' + (el.textContent||'').trim().slice(0,12));
      });
    });
    return JSON.stringify(out);
  })()`;

  for (const [name, hash] of [["家长·老师", "#/educator"], ["教育研究者", "#/researcher"]]) {
    await send("Page.navigate", { url: BASE + hash });
    await sleep(6000);
    const before = await ev(probe(hash));
    // 真实折叠：点侧栏头部那枚按钮（写 localStorage 对 practice 不生效，它的状态由点击驱动）
    const clicked = await ev(`(function(){
      var d = document.getElementById('frame').contentDocument;
      var b = d.querySelector('#nav-fold-btn') || d.querySelector('.menu-btn') || d.querySelector('#menubtn');
      if (!b) return 'no-button';
      b.click(); return 'clicked:' + (b.id || b.className);
    })()`);
    await sleep(1500);
    const after = await ev(probe(hash));
    console.log(`\n=== ${name} ===  (${clicked})`);
    console.log("  展开态:", before);
    console.log("  折叠态:", after);
  }

  ws.close(); try { proc.kill(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error("probe 失败:", e.message); try { proc.kill(); } catch (e2) {} process.exit(2); });
