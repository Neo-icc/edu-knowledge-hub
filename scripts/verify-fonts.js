// 验证 8 个自托管字体在浏览器里真正解码成功（status === loaded，且渲染宽度区别于回退字体）
const http = require("http");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9740 + Math.floor(Math.random() * 20);
const BASE = "http://127.0.0.1:8899/practice/index.html";

const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + path.join(os.tmpdir(), "edge-font-" + Date.now()),
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
  ws.on("message", m => {
    const msg = JSON.parse(m);
    if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg.result); pend.delete(msg.id); }
  });
  await new Promise(r => ws.on("open", r));
  await send("Page.enable");
  await send("Page.navigate", { url: BASE });
  await sleep(3200);

  const out = await send("Runtime.evaluate", {
    expression: `(async () => {
      // 先强制触发全部 8 个 face 的使用，避免"页面没用到→unloaded"被误判为失败
      const specs = [['Fraunces',400],['Fraunces',600],['Fraunces',700],
                     ['Spline Sans',400],['Spline Sans',500],['Spline Sans',600],
                     ['Spline Sans Mono',400],['Spline Sans Mono',500]];
      specs.forEach(([f,w]) => {
        const s = document.createElement('span');
        s.textContent = 'Hamburgefonstiv 0123456789';
        s.style.cssText = "position:absolute;left:-9999px;font-size:40px;font-family:'" + f + "';font-weight:" + w;
        document.body.appendChild(s);
      });
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 600));
      const faces = [];
      document.fonts.forEach(f => faces.push({ fam: f.family, w: f.weight, st: f.status }));
      // 用同一段文字在自定义字体与回退字体下测宽，确认真的换了字形
      const probe = (fam, weight, text) => {
        const s = document.createElement('span');
        s.textContent = text;
        s.style.cssText = 'position:absolute;left:-9999px;font-size:80px;white-space:nowrap;font-family:' + fam + ';font-weight:' + weight;
        document.body.appendChild(s);
        const w = s.getBoundingClientRect().width;
        s.remove();
        return Math.round(w * 100) / 100;
      };
      const t = 'Hamburgefonstiv 0123456789 — “quotes”';
      return JSON.stringify({
        faces,
        widths: {
          fraunces700: probe('Fraunces', 700, t),
          fallbackSerif: probe('Georgia,serif', 700, t),
          spline400: probe('Spline Sans', 400, t),
          fallbackSans: probe('Arial,sans-serif', 400, t),
          mono400: probe('Spline Sans Mono', 400, 'M0123456789')
        }
      });
    })()`,
    returnByValue: true, awaitPromise: true,
  });

  const d = JSON.parse(out.result.value);
  console.log("=== @font-face 状态 ===");
  d.faces.forEach(f => console.log(`  ${f.fam.padEnd(18)} ${String(f.w).padEnd(6)} ${f.st}`));
  console.log("=== 渲染宽度（自定义 vs 系统回退） ===");
  console.log("  Fraunces 700 :", d.widths.fraunces700, "| Georgia:", d.widths.fallbackSerif);
  console.log("  Spline  400  :", d.widths.spline400, "| Arial  :", d.widths.fallbackSans);
  console.log("  Mono    400  :", d.widths.mono400);

  const allLoaded = d.faces.length === 8 && d.faces.every(f => f.st === "loaded");
  const serifDiff = Math.abs(d.widths.fraunces700 - d.widths.fallbackSerif) > 1;
  const sansDiff = Math.abs(d.widths.spline400 - d.widths.fallbackSans) > 1;
  console.log("\n结论:",
    allLoaded ? "8/8 全部 loaded ✅" : "存在未加载 ❌",
    "| 与回退字体有差异:", serifDiff && sansDiff ? "是 ✅（真的生效）" : "否 ❌");

  await send("Browser.close");
  proc.kill();
  process.exit(allLoaded && serifDiff && sansDiff ? 0 : 1);
})().catch(e => { console.error("ERR", e.message); try { proc.kill(); } catch (_) {} process.exit(1); });
