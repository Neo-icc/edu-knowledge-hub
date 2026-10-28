// 对比两个入口的侧栏：宽度、折叠按钮位置、折叠前后主区宽度
const http = require("http");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9860 + Math.floor(Math.random() * 20);

const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + path.join(os.tmpdir(), "edge-nav-" + Date.now()),
  "--window-size=1440,900", "about:blank",
], { stdio: "ignore" });

const get = p => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, r => {
    let d = ""; r.on("data", c => d += c); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on("error", rej);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PROBE = `(() => {
  const R = n => Math.round(n * 10) / 10;
  const out = { url: location.pathname + location.hash, cssVars: {} };

  const cs = getComputedStyle(document.documentElement);
  ["--rail", "--nav-w", "--side-w", "--sidebar-w"].forEach(k => {
    const v = cs.getPropertyValue(k).trim();
    if (v) out.cssVars[k] = v;
  });

  // 侧栏：取左侧固定/占位、宽度>140 的元素
  const cands = [...document.querySelectorAll("aside, .sidebar, #sidebar, .rail, .nav, #nav, .app-shell > *, .layout > *")]
    .map(el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { tag: el.tagName, cls: (el.className || "").toString().slice(0, 40), w: R(r.width), left: R(r.left), h: R(r.height), pos: s.position, disp: s.display, ovf: s.overflowY };
    })
    .filter(o => o.w > 140 && o.left < 400 && o.disp !== "none");
  out.sidebars = cands.slice(0, 4);

  // 主区
  const main = document.querySelector("main, .main, #main, .content, .app-shell > main");
  if (main) { const r = main.getBoundingClientRect(); out.main = { w: R(r.width), left: R(r.left) }; }
  const shell = document.querySelector(".app-shell, .layout, .wrap-main, .shell");
  if (shell) {
    const s = getComputedStyle(shell);
    out.shellCols = (s.gridTemplateColumns || "") + " | " + (s.display || "");
  }

  // 折叠按钮：找带「收起/展开/目录」文本的小按钮
  const btns = [...document.querySelectorAll("button, a, [role=button]")].map(el => {
    const t = (el.textContent || "").trim().replace(/\\s+/g, " ");
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { t: t.slice(0, 14), w: R(r.width), h: R(r.height), left: R(r.left), top: R(r.top), disp: s.display, vis: s.visibility };
  }).filter(o => /收起|展开|目录|折叠/.test(o.t) && o.disp !== "none");
  out.foldBtns = btns.slice(0, 5);

  // 折叠状态来源
  out.storageKeys = Object.keys(localStorage).filter(k => /fold|nav|collapse/i.test(k));
  out.bodyClass = document.body.className;
  out.htmlClass = document.documentElement.className;
  return JSON.stringify(out);
})()`;

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
  ws.on("message", m => {
    const msg = JSON.parse(m);
    if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg.result); pend.delete(msg.id); }
  });
  await new Promise(r => ws.on("open", r));
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const B = process.argv[2] || "http://127.0.0.1:8899";
  for (const [name, url] of [["家长教师 practice", B + "/practice/"], ["教育学者 research", B + "/research/"]]) {
    await send("Runtime.evaluate", { expression: "try{localStorage.clear()}catch(e){}" });
    await send("Page.navigate", { url });
    await sleep(3200);
    const open = await send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
    console.log("\n########## " + name + " ##########");
    console.log("展开态:", open.result.value);

    // 点折叠按钮
    const clicked = await send("Runtime.evaluate", {
      expression: `(()=>{const b=[...document.querySelectorAll("button,a,[role=button]")].find(el=>/收起|目录/.test((el.textContent||"").trim()));if(!b)return"no-btn";b.click();return "clicked:"+(b.textContent||"").trim().slice(0,10);})()`,
      returnByValue: true,
    });
    await sleep(1200);
    const shut = await send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
    console.log("点击结果:", clicked.result.value);
    console.log("折叠态:", shut.result.value);
  }

  await send("Browser.close");
  proc.kill();
  process.exit(0);
})().catch(e => { console.error("ERR", e.message); try { proc.kill(); } catch (_) {} process.exit(1); });
