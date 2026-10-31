// 线上冒烟：用 CDP 打开生产站点，等 DOM 就绪后断言关键结构 + 收集控制台错误
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.SMOKE_BASE || "https://www.epck.space/";
const PORT = 9520 + Math.floor(Math.random() * 20);

const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + path.join(os.tmpdir(), "edge-smoke-" + Date.now()),
  "--window-size=1440,900", "about:blank",
], { stdio: "ignore" });

const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, (r) => {
    let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(JSON.parse(d)));
  }).on("error", rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PASS = 0, FAIL = 0;
const ok = (name, detail, cond) => {
  console.log(`  [${cond ? "OK" : "FAIL"}]   ${name.padEnd(26)} ${detail}`);
  cond ? PASS++ : FAIL++;
};

(async function main() {
  let list = null;
  for (let i = 0; i < 40 && !list; i++) {
    try { list = await getJSON("/json/list"); } catch (e) { await sleep(250); }
  }
  if (!list) throw new Error("无法连接 Edge 调试端口");
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r) => ws.on("open", r));

  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      consoleErrors.push(m.params.args.map((a) => a.value || a.description || "").join(" "));
    }
    if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push("EXCEPTION: " + (m.params.exceptionDetails.exception?.description || ""));
    }
  });
  const send = (method, params) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

  await send("Runtime.enable");
  await send("Page.enable");

  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };
  const goto = async (url) => {
    await send("Page.navigate", { url });
    await sleep(3500);
  };

  console.log(`\n=== 线上冒烟 · ${BASE} ===\n`);

  // 1. 门户
  await goto(BASE);
  ok("首页标题", await evaluate("document.title"), /教育与心智/.test(await evaluate("document.title")));
  ok("两张身份卡", "count=" + (await evaluate("document.querySelectorAll('.ident').length")), (await evaluate("document.querySelectorAll('.ident').length")) === 2);
  ok("无顶栏（落地区）", "hidden=" + (await evaluate("document.getElementById('topbar').hidden")), (await evaluate("document.getElementById('topbar').hidden")) === true);

  // 2. 家长·老师入口（走 hash 路由，验证 iframe 是否真正加载数据）
  await goto(BASE + "#/educator");
  await sleep(3000);
  const inner1 = await evaluate(`(function(){try{
    var f=document.getElementById('frame');
    if(!f||!f.contentDocument) return 'no-frame';
    var d=f.contentDocument;
    var sc=d.querySelectorAll('[href*="scenario"],.sc-card,.scenario').length;
    return 'title='+d.title.slice(0,18)+' | scenes~'+sc+' | body='+d.body.innerText.length;
  }catch(e){return 'ERR '+e.message}})()`);
  ok("practice iframe 加载", inner1, /title=/.test(String(inner1)));

  // 3. 研究者入口
  await goto(BASE + "#/researcher");
  await sleep(3500);
  const inner2 = await evaluate(`(function(){try{
    var f=document.getElementById('frame');
    var d=f.contentDocument;
    return 'title='+d.title.slice(0,18)+' | body='+d.body.innerText.length;
  }catch(e){return 'ERR '+e.message}})()`);
  ok("research iframe 加载", inner2, /title=/.test(String(inner2)));

  // 4. 数据包：从 practice 页面的实际引用里取指纹，不要写死——
  //    写死会在下次重建后失效（本脚本自己踩过：硬编码旧指纹导致误报 404）
  const bundleName = await evaluate(`(async function(){
    try {
      var r = await fetch('practice/');
      var t = await r.text();
      var m = t.match(/bundle-data-[a-z0-9]+\\.js/);
      return m ? m[0] : null;
    } catch (e) { return null; }
  })()`);
  const hasNew = bundleName
    ? await evaluate("(async function(){ var r = await fetch('practice/" + bundleName +
        "', {method:'HEAD'}); return r.status; })()")
    : null;
  ok("数据包引用可达", (bundleName || "未取到") + " status=" + hasNew, hasNew === 200);

  ok("控制台无错误", "errors=" + consoleErrors.length + (consoleErrors.length ? " → " + consoleErrors[0].slice(0, 80) : ""), consoleErrors.length === 0);

  console.log(`\n=== 结果：通过 ${PASS} · 失败 ${FAIL} ===\n`);
  ws.close();
  try { proc.kill(); } catch (e) {}
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error("冒烟失败:", e.message);
  try { proc.kill(); } catch (e2) {}
  process.exit(2);
});
