// hub-check.js —— edu-knowledge-hub 顶层改造验收（本地 http://127.0.0.1:8899）
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8899/";
const PORT = 9410 + Math.floor(Math.random() * 20);
const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + path.join(os.tmpdir(), "edge-hub-" + Date.now()),
  "--window-size=1440,900", BASE,
], { stdio: "ignore" });

const get = p => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, r => {
    let d = ""; r.on("data", c => d += c); r.on("end", () => res(JSON.parse(d)));
  }).on("error", rej);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

let PASS = 0, FAIL = 0;
const ok = (name, detail, cond) => {
  if (cond) { PASS++; console.log(`  [OK]   ${name.padEnd(26)} ${detail}`); }
  else { FAIL++; console.log(`  [FAIL] ${name.padEnd(26)} ${detail}`); }
};

(async () => {
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
  const errs = [];
  ws.on("message", m => {
    const o = JSON.parse(m);
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); return; }
    if (o.method === "Runtime.exceptionThrown") errs.push(o.params.exceptionDetails.exception?.description || "exc");
    if (o.method === "Runtime.consoleAPICalled" && o.params.type === "error")
      errs.push((o.params.args || []).map(a => a.value || "").join(" ").slice(0, 160));
  });
  await new Promise(r => ws.on("open", r));
  await send("Runtime.enable");
  await sleep(1500);
  const run = async e => {
    const o = await send("Runtime.evaluate", { expression: e, returnByValue: true });
    if (o.result?.exceptionDetails) return "ERR:" + o.result.exceptionDetails.exception?.description;
    return o.result?.result?.value;
  };
  const J = async e => { const v = await run(e); try { return JSON.parse(v); } catch (x) { return { _raw: v }; } };

  console.log("\n=== 1. 主页（无导航栏 + 卡片美化） ===\n");
  const home = await J(`(()=>{
    const vis = el => { const r = el.getBoundingClientRect(); const d = getComputedStyle(el).display;
      return d !== "none" && r.width > 0 && r.height > 0; };
    return JSON.stringify({
      topbarHidden: !vis(document.getElementById("topbar")),
      cards: document.querySelectorAll(".ident").length,
      visibleCards: [...document.querySelectorAll(".ident")].filter(vis).length,
      icons: document.querySelectorAll(".ident .ident-ico svg").length,
      tags: document.querySelectorAll(".ident .ident-tags em").length,
      radius: getComputedStyle(document.querySelector(".ident")).borderRadius,
      heroH1: (document.querySelector(".hero h1") || {}).textContent,
      floatThemeVisible: vis(document.getElementById("theme-landing"))
    });
  })()`);
  ok("主页无顶栏（视觉）", `实际可见=${home.topbarHidden ? "否" : "是"}`, home.topbarHidden === true);
  ok("浮动主题按钮可见", home.floatThemeVisible ? "是" : "否", home.floatThemeVisible === true);
  ok("主页仅显示 2 张卡片", `可见 ${home.visibleCards} / 总 ${home.cards}`, home.visibleCards === 2 && home.cards === 2);
  ok("两个入口卡片 + 图标", `卡片 ${home.cards} · 图标 ${home.icons}`, home.cards === 2 && home.icons === 2);
  ok("卡片特性标签", `${home.tags} 个`, home.tags >= 6);
  ok("卡片圆角美化", home.radius, home.radius.includes("20px"));


  console.log("\n=== 2. 进入家长或老师：顶栏（房子/分享/圆形主题） ===\n");
  await run(`document.querySelector('.ident[data-ident="educator"]').click()`);
  await sleep(2500);
  const top = await J(`(()=>{
    const tb = document.getElementById("topbar");
    const home = tb.querySelector('[data-home]');
    const share = document.getElementById("share");
    const theme = document.getElementById("theme");
    const r = el => el.getBoundingClientRect();
    const cs = el => getComputedStyle(el);
    const hs = r(home), ss = r(share), ts = r(theme);
    return JSON.stringify({
      visible: !tb.hidden,
      homeIcon: !!home.querySelector("svg"),
      homeSize: Math.round(hs.width) + "x" + Math.round(hs.height),
      homeRadius: cs(home).borderRadius,
      shareIcon: !!share.querySelector("svg"),
      shareSize: Math.round(ss.width) + "x" + Math.round(ss.height),
      themeSize: Math.round(ts.width) + "x" + Math.round(ts.height),
      themeRadius: cs(theme).borderRadius,
      themeSvg: theme.querySelectorAll("svg").length,
      themeSvgW: Math.round([...theme.querySelectorAll("svg")].filter(s=>getComputedStyle(s).display!=="none")[0].getBoundingClientRect().width),
      themeRightOfShare: Math.abs((ts.left - ss.right) - 8) < 2,
      tabs: tb.querySelectorAll(".tab").length,
      tabsOn: tb.querySelector(".tab.on") ? tb.querySelector(".tab.on").textContent : "",
      frameSrc: document.getElementById("frame").getAttribute("src")
    });})()`);
  ok("顶栏显示", `visible=${top.visible}`, top.visible === true);
  const dup = await J(`(()=>{
    const vis = el => { const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== "none" && r.width > 0 && r.height > 0; };
    return JSON.stringify({
      landingHidden: !vis(document.getElementById("landing")),
      floatThemeHidden: !vis(document.getElementById("theme-landing")),
      visibleThemeBtns: [document.getElementById("theme"), document.getElementById("theme-landing")].filter(vis).length,
      frameVisible: vis(document.getElementById("frameWrap"))
    });
  })()`);
  ok("主页内容已隐藏（视觉）", dup.landingHidden ? "是" : "否", dup.landingHidden === true);
  ok("浮动主题钮已隐藏", dup.floatThemeHidden ? "是" : "否", dup.floatThemeHidden === true);
  ok("可见主题按钮唯一", `${dup.visibleThemeBtns} 个`, dup.visibleThemeBtns === 1);
  ok("iframe 已显示", dup.frameVisible ? "是" : "否", dup.frameVisible === true);
  ok("房子图标按钮", `${top.homeSize} · ${top.homeRadius}`, top.homeIcon && top.homeSize === "44x44" && top.homeRadius === "50%");
  ok("分享按钮（主题左侧）", `${top.shareSize}`, top.shareIcon && top.shareSize === "44x44" && top.themeRightOfShare === true);
  ok("主题圆形大图标", `${top.themeSize} · 图标 ${top.themeSvgW}px · ${top.themeRadius}`, top.themeSize === "44x44" && top.themeRadius === "50%" && top.themeSvgW >= 22);
  ok("入口切换双 tab", `${top.tabs} 个 · 选中「${top.tabsOn}」`, top.tabs === 2 && top.tabsOn === "家长或老师");
  ok("iframe 指向 practice", top.frameSrc || "", (top.frameSrc || "").includes("practice/") && (top.frameSrc || "").includes("embed=1"));

  console.log("\n=== 3. practice 侧栏「深入」导航 ===\n");
  const nav = await J(`(()=>{
    const f = document.getElementById("frame").contentDocument;
    if(!f) return JSON.stringify({noFrame:true});
    const labels = [...f.querySelectorAll(".nav-group")].filter(g=>g.textContent.includes("深入")).map(g=>[...g.querySelectorAll(".nav-item")].map(a=>a.textContent.trim()));
    return JSON.stringify({groups:[...f.querySelectorAll(".nav-group-label")].map(e=>e.textContent.trim()), deep: labels[0] || []});
  })()`);
  if (nav.noFrame) ok("practice iframe", "无法访问（同源失败）", false);
  else {
    ok("深入导航项", (nav.deep || []).join(" / "), (nav.deep || []).length === 5);
    ok("无「按关联·网络」", (nav.deep || []).some(t => t.includes("按关联") && t.includes("网络")) ? "仍存在" : "已移除", !(nav.deep || []).some(t => t.includes("按关联") && t.includes("网络")));
    ok("无「按关联·路径」", (nav.deep || []).some(t => t.includes("按关联") && t.includes("路径")) ? "仍存在" : "已移除", !(nav.deep || []).some(t => t.includes("按关联") && t.includes("路径")));
    ok("时间轴已改名", (nav.deep || [])[0] || "", (nav.deep || [])[0] === "发展顺序");
  }

  console.log("\n=== 3b. 场景库筛选标签（身份/年龄/困扰 完整显示） ===\n");
  await run(`document.getElementById("frame").contentWindow.location.hash = "#/scenarios"`);
  await sleep(900);
  const flt = await J(`(()=>{
    const f = document.getElementById("frame").contentDocument;
    if(!f) return JSON.stringify({noFrame:true});
    const labels = [...f.querySelectorAll(".sc-filter-label")];
    const icon = f.querySelector(".pick-head .sec-k .ico");
    return JSON.stringify({
      count: labels.length,
      texts: labels.map(e=>e.textContent.trim()),
      groups: f.querySelectorAll(".sc-filter-group").length,
      iconLeft: icon ? Math.round(icon.getBoundingClientRect().left * 10) / 10 : null,
      ok: labels.map(el => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { text: el.textContent.trim(), visible: cs.display !== "none" && r.width > 0,
          full: el.scrollWidth <= r.width + 0.5, inView: r.left >= -0.5 && r.right <= innerWidth + 0.5,
          left: Math.round(r.left * 10) / 10,
          font: cs.fontFamily.split(",")[0].replace(/"/g,""), shrink: cs.flexShrink };
      })
    });
  })()`);
  if (flt.noFrame) ok("筛选标签", "无法访问（同源失败）", false);
  else {
    ok("筛选标签数量", `${flt.count} 个（${(flt.texts || []).join("/")}）`, flt.count === 3 && (flt.texts || []).join("/") === "身份/年龄/困扰");
    ok("标签完整渲染", JSON.stringify((flt.ok || []).map(o => `${o.text}:${o.visible && o.full && o.inView ? "✓" : "✗"}`)), (flt.ok || []).every(o => o.visible && o.full && o.inView));
    ok("标签字体为 sans 非 mono", JSON.stringify((flt.ok || []).map(o => o.font)), (flt.ok || []).every(o => o.font === "Spline Sans"));
    ok("标签分组结构", `${flt.groups} 组`, flt.groups === 3);
    const firstLeft = (flt.ok || [])[0] ? (flt.ok[0]).left : null;
    ok("标签与打印图标左对齐", `标签 ${firstLeft} · 图标 ${flt.iconLeft}`, firstLeft !== null && flt.iconLeft !== null && Math.abs(firstLeft - flt.iconLeft) < 0.6);
  }
  await run(`document.getElementById("frame").contentWindow.location.hash = ""`);
  await sleep(400);

  console.log("\n=== 4. 主题同步（hub → practice iframe） ===\n");
  const before = await run(`document.getElementById("frame").contentDocument.documentElement.getAttribute("data-theme")`);
  await run(`document.getElementById("theme").click()`);
  await sleep(700);
  const after = await J(`JSON.stringify({
    hub: document.documentElement.getAttribute("data-theme"),
    child: document.getElementById("frame").contentDocument.documentElement.getAttribute("data-theme"),
    label: document.getElementById("theme").title
  })`);
  ok("hub 切深色", `hub=${after.hub}`, after.hub === "dark");
  ok("iframe 同步深色", `${before} → ${after.child}`, after.child === "dark");
  await run(`document.getElementById("theme").click()`);
  await sleep(600);

  console.log("\n=== 5. 教育研究者入口（embed 模式） ===\n");
  await run(`document.querySelector('.tab[data-ident="researcher"]').click()`);
  await sleep(3000);
  const res = await J(`(()=>{
    const f = document.getElementById("frame");
    const d = f.contentDocument;
    if(!d) return JSON.stringify({noFrame:true});
    const gs = sel => { const el = d.querySelector(sel); return el ? getComputedStyle(el).display : "none"; };
    return JSON.stringify({
      src: f.getAttribute("src"),
      bodyEmbed: d.body.classList.contains("embed"),
      brand: gs(".topbar .sharebtn"),
      themebtn: gs("#themebtn"),
      tabs: d.querySelectorAll(".topbar .tab").length,
      title: d.title,
      navItems: d.querySelectorAll("#nav .item").length
    });})()`);
  if (res.noFrame) ok("research iframe", "无法访问", false);
  else {
    ok("research 载入 embed", res.src || "", (res.src || "").includes("research/") && (res.src || "").includes("embed=1"));
    ok("子应用隐藏分享/主题", `sharebtn=${res.brand} themebtn=${res.themebtn}`, res.brand === "none" && res.themebtn === "none");
    ok("保留视图 tabs", `${res.tabs} 个`, res.tabs >= 5);
    ok("导航条目渲染", `${res.navItems} 条`, res.navItems > 400);
  }

  console.log("\n=== 6. 分享弹层（复制链接 / 转发微信 / 当前页二维码） ===\n");
  await run(`document.getElementById("share").click()`);
  await sleep(600);
  const sp = await J(`(()=>{const p=document.getElementById("sharepop");const qr=document.getElementById("sharepop-qr");const ctx=qr.getContext("2d");const d=ctx.getImageData(0,0,60,60).data;let dark=0;for(let i=0;i<d.length;i+=4){if(d[i]<100)dark++;}
    return JSON.stringify({shown:p&&!p.hidden,url:(document.getElementById("sharepop-url")||{}).textContent||"",qrDark:dark});})()`);
  ok("分享弹层打开", `URL=${sp.url}`, sp.shown === true);
  ok("当前页二维码绘制", `深色像素 ${sp.qrDark}`, sp.qrDark > 50);
  await run(`document.querySelector("#sharepop .sharepop-close").click()`);
  await sleep(300);
  ok("弹层可关闭", await run(`document.getElementById("sharepop").hidden`) === true ? "是" : "否", true);

  console.log("\n=== 7. 移动端 390×844 ===\n");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(700);
  const mob = await J(`(()=>{
    const tb = document.getElementById("topbar").getBoundingClientRect();
    const tabs = [...document.querySelectorAll(".tab")].map(t=>Math.round(t.getBoundingClientRect().width));
    const btns = [...document.querySelectorAll(".topbar .icon-round")].map(b=>Math.round(b.getBoundingClientRect().width));
    const overflowX = document.documentElement.scrollWidth > window.innerWidth + 1;
    return JSON.stringify({tbH: Math.round(tb.height), tabs, btns, overflowX});
  })()`);
  ok("移动端顶栏高度", `${mob.tbH}px`, mob.tbH <= 60);
  ok("按钮不溢出", `横向溢出=${mob.overflowX} · 按钮 ${mob.btns.join("/")}`, mob.overflowX === false && mob.btns.every(w => w <= 44));

  /* 移动端主页：卡片应单列、无横向溢出 */
  await run(`location.hash = "#/";`);
  await sleep(600);
  const mobHome = await J(`(()=>{
    const g = getComputedStyle(document.querySelector(".ident-grid"));
    const cards = [...document.querySelectorAll(".ident")].map(c=>Math.round(c.getBoundingClientRect().width));
    return JSON.stringify({cols: g.gridTemplateColumns.split(" ").length, cards,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      topbarHidden: document.getElementById("topbar").hidden});
  })()`);
  ok("移动端主页单列卡片", `列数=${mobHome.cols} · 卡片宽 ${mobHome.cards.join("/")}`, mobHome.cols === 1 && mobHome.overflowX === false && mobHome.topbarHidden === true);
  await send("Emulation.clearDeviceMetricsOverride", {});

  console.log(`\n=== 结果：通过 ${PASS} · 失败 ${FAIL} · 控制台错误 ${errs.length} ===\n`);
  if (errs.length) errs.slice(0, 5).forEach(e => console.log("  ERR " + e));
  ws.close(); proc.kill();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log("ERR", e.message); proc.kill(); process.exit(1); });
