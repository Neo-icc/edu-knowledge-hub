// social-shots.js —— 朋友圈推广 9 张核心功能截图（1440×900 @2x 高清）
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "C:/Users/Stephen/WorkBuddy/2026-10-22-18-31-19/edu-knowledge-hub/screenshots/social";
const BASE = "http://127.0.0.1:8899/";
const PORT = 9310 + Math.floor(Math.random() * 10);
const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", "--no-proxy-server",
  "--force-device-scale-factor=2",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + path.join(os.tmpdir(), "edge-social-" + Date.now()),
  "--window-size=1440,900", BASE,
], { stdio: "ignore" });

const get = p => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, r => {
    let d = ""; r.on("data", c => d += c); r.on("end", () => res(JSON.parse(d)));
  }).on("error", rej);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let list = null;
  for (let i = 0; i < 60; i++) {
    try { list = await get("/json/list"); if (list && list.length) break; } catch (e) {}
    await sleep(300);
  }
  const page = list.find(t => t.type === "page");
  const WebSocket = require("ws");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise(res => {
    const i = ++id; pend.set(i, res);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
  ws.on("message", m => {
    const o = JSON.parse(m);
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); }
  });
  await new Promise(r => ws.on("open", r));
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  const run = async e => {
    const o = await send("Runtime.evaluate", { expression: e, returnByValue: true });
    if (o.result?.exceptionDetails) return "ERR:" + o.result.exceptionDetails.exception?.description;
    return o.result?.result?.value;
  };
  const waitFor = async (expr, tries = 200, step = 400) => {
    for (let i = 0; i < tries; i++) {
      try { if (await run(expr) === true) return true; } catch (e) {}
      await sleep(step);
    }
    return false;
  };
  const shot = async name => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, "base64"));
    console.log("OK ", name, Math.round(Buffer.from(r.result.data, "base64").length / 1024) + "KB");
  };
  const goto = async (url, readyExpr) => {
    await send("Page.navigate", { url });
    const ok = await waitFor(readyExpr);
    if (!ok) console.log("  [warn] 等待超时:", readyExpr.slice(0, 60));
    await sleep(1200);
  };

  /* 1. 双入口主页 */
  await goto(BASE, `!!document.querySelector(".ident")`);
  await shot("01-hub-home.png");

  /* 2. 家长端 · 场景库 */
  await goto(BASE + "practice/#/scenarios", `document.querySelectorAll(".sc-card").length > 10`);
  await shot("02-scenarios.png");

  /* 3. 家长端 · 场景详情（展开第一张场景卡，展示按龄建议与一页纸按钮） */
  await run(`(()=>{const c=document.querySelector(".sc-card");if(c){c.setAttribute("open","");const s=c.querySelector("summary");s.scrollIntoView({block:"start"});}})()`);
  await sleep(1000);
  await shot("03-scenario-sheet.png");

  /* 4. 家长端 · 发展顺序（时间轴，HTML 节点结构） */
  await goto(BASE + "practice/#/timeline", `document.querySelectorAll(".tl-period").length > 2`);
  await sleep(1200);
  await shot("04-timeline-practice.png");

  /* 5. 家长端 · 理论对比（E001 柏拉图教育思想 vs E048 另一领域条目，hash 路由直连） */
  await goto(BASE + "practice/#/compare?a=E001&b=E048",
    `document.querySelectorAll(".cmp-shared-item, .cmp-section").length > 1`);
  await sleep(1000);
  await shot("05-compare.png");

  /* 6. 研究者端 · 概览（统计卡片 + 五大领域章节） */
  await goto(BASE + "research/", `document.querySelectorAll("#v-overview .stat").length > 4`);
  await shot("06-research-overview.png");

  /* 7. 研究者端 · 观点时间轴（全标注） */
  await goto(BASE + "research/", `document.querySelectorAll(".topbar .tab").length > 3`);
  await run(`document.querySelector('.tab[data-view="timeline"]').click()`);
  await waitFor(`window.__tlLabelsDrawn > 50`, 120);
  await sleep(1000);
  await shot("07-research-timeline.png");

  /* 8. 研究者端 · 关联网络（全标注） */
  await run(`document.querySelector('.tab[data-view="net"]').click()`);
  await waitFor(`typeof netBuilt !== "undefined" && netBuilt === true`, 120);
  await sleep(2500);
  await shot("08-research-network.png");

  /* 9. 研究者端 · 人物索引（54 位头像齐全） */
  await run(`document.querySelector('.tab[data-view="thinkers"]').click()`);
  await waitFor(`document.querySelectorAll(".thcard").length > 40`, 120);
  await sleep(800);
  await shot("09-thinkers.png");

  ws.close(); proc.kill();
  console.log("\n9 张截图完成 →", OUT);
  process.exit(0);
})().catch(e => { console.log("ERR", e.message); proc.kill(); process.exit(1); });
