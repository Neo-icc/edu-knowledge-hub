/* ============================================================
   uptime-check.js —— 站点可用性巡检（抓「间歇性打不开」的现场）

   背景：epck.space 出现过「有时能开、有时 403」的间歇故障，事后追问查不出原因，
   必须有带时间戳的连续记录才能判断是固定时段、还是随机发生、返回的是谁的拦截页。

   用法：
     node scripts/uptime-check.js                 巡检一次，追加一行到日志
     node scripts/uptime-check.js --verbose       把每次结果都打印出来
     node scripts/uptime-check.js --summary       只打印最近 24 小时汇总

   日志：默认写到 <工作区>/uptime/uptime.jsonl（不在仓库内，避免污染版本库）
        可用环境变量 UPTIME_LOG 覆盖
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const LOG = process.env.UPTIME_LOG ||
  path.resolve(__dirname, "..", "..", "uptime", "uptime.jsonl");

/* 只测「用户真实会走的入口」：协议 × 主机 × 三个页面 */
const TARGETS = [
  { url: "https://www.epck.space/", note: "门户首页" },
  { url: "https://www.epck.space/practice/", note: "家长老师入口" },
  { url: "https://www.epck.space/research/", note: "研究者入口" },
  { url: "https://epck.space/", note: "裸域 HTTPS" },
  { url: "http://www.epck.space/", note: "HTTP（用来抓 403）" },
  { url: "http://epck.space/", note: "裸域 HTTP（用来抓 403）" },
];

/* 慢到什么程度算异常：门户 8s、子应用 10s */
const SLOW_MS = 8000;

/* 拦截页特征：403 时能认出是谁返回的 */
const BLOCK_HINTS = ["拒绝", "无法访问", "Forbidden", "blocked", "Access Denied", "未备案"];

async function probe(t) {
  const started = Date.now();
  const rec = { ts: new Date().toISOString(), url: t.url, note: t.note };
  try {
    const res = await fetch(t.url, {
      redirect: "manual",                 // 不自动跟随，才能看清 301/302
      signal: AbortSignal.timeout(25000),
      headers: { "User-Agent": "epck-uptime/1.0" },
    });
    rec.status = res.status;
    rec.ms = Date.now() - started;
    if (res.status >= 300 && res.status < 400) {
      rec.location = res.headers.get("location") || "";
    }
    if (res.status !== 200) {
      const body = (await res.text()).slice(0, 300);
      const hit = BLOCK_HINTS.find((h) => body.includes(h));
      rec.bodyHint = hit || "";
      rec.body = body.replace(/\s+/g, " ").slice(0, 160);
    }
  } catch (e) {
    rec.status = 0;
    rec.ms = Date.now() - started;
    rec.error = String(e && e.message || e).slice(0, 120);
  }
  rec.ok = rec.status === 200;
  rec.slow = rec.ms > SLOW_MS;
  return rec;
}

(async function main() {
  if (process.argv.includes("--summary")) {
    if (!fs.existsSync(LOG)) return console.log("暂无巡检记录");
    const rows = fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    const since = Date.now() - 24 * 3600 * 1000;
    const recent = rows.filter((r) => new Date(r.ts).getTime() >= since);
    const bad = recent.filter((r) => !r.ok || r.slow);
    console.log(`最近 24 小时：${recent.length} 次探测，异常 ${bad.length} 次`);
    const byUrl = {};
    for (const r of bad) {
      byUrl[r.url] = byUrl[r.url] || { n: 0, codes: {}, maxMs: 0, sample: "" };
      const b = byUrl[r.url];
      b.n++;
      b.codes[r.status] = (b.codes[r.status] || 0) + 1;
      b.maxMs = Math.max(b.maxMs, r.ms || 0);
      if (!b.sample && r.body) b.sample = r.body;
    }
    for (const [u, b] of Object.entries(byUrl)) {
      console.log(`  ${u}  异常 ${b.n} 次  状态码 ${JSON.stringify(b.codes)}  最慢 ${(b.maxMs / 1000).toFixed(1)}s`);
      if (b.sample) console.log(`    返回片段：${b.sample}`);
    }
    return;
  }

  const verbose = process.argv.includes("--verbose");
  const rows = [];
  for (const t of TARGETS) rows.push(await probe(t));   // 串行，避免自己把带宽打满

  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

  const bad = rows.filter((r) => !r.ok || r.slow);
  if (verbose || bad.length) {
    for (const r of rows) {
      const mark = r.ok && !r.slow ? "OK  " : "!!  ";
      const extra = r.error ? ` error=${r.error}` :
        (r.location ? ` → ${r.location}` : "") + (r.bodyHint ? ` 【${r.bodyHint}】` : "");
      console.log(`${mark} ${String(r.status).padEnd(3)} ${(r.ms / 1000).toFixed(1)}s  ${r.url}${extra}`);
    }
  }

  if (!bad.length) {
    console.log(`全部正常（${rows.length} 个探测点）`);
  } else {
    console.log(`\n异常 ${bad.length}/${rows.length} 个探测点 —— 已记录到 ${LOG}`);
    for (const r of bad) {
      if (r.body) console.log(`  ${r.url} 返回：${r.body.slice(0, 120)}`);
    }
  }
  process.exitCode = bad.length ? 1 : 0;
})();
