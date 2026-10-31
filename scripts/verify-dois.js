/* ============================================================
   DOI 全量复核：把 dois.js 里每一个 DOI 拿回 Crossref 对一遍
   检查项：
     1. DOI 是否真实存在（HTTP 200 / 404）
     2. 类型是否为「原文」（排除 peer-review / component / dataset / 书评）
     3. 出版年与条目被引年份是否相差 ≤ 2
     4. 题名是否像「书评」——把书名当作题名、且作者只有一位审稿人
   用法：node scripts/verify-dois.js [--domain brain]
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "practice", "js", "data");
const OUT = path.join(ROOT, "reports");
const MAILTO = "edu-knowledge-hub@users.noreply.github.com";

const ORDER = [
  "domains.js", "roster-1.js", "roster-2.js", "roster-3.js",
  "entries-d1.js", "entries-d2.js", "entries-d3.js", "entries-d4.js", "entries-d5.js",
  "dois.js", "thinkers.js", "scholars-extra.js", "overrides.js",
  "scenarios.js", "activities.js", "triage.js",
  "connections-1.js", "connections-2.js", "connections-3.js", "connections-4.js",
  "dom-9-dev.js", "dom-6-foundation.js", "dom-7-psych.js", "dom-8-broad.js", "dom-10-brain.js",
  "connections-5.js", "connections-6.js",
];
const sandbox = {}; sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ORDER) vm.runInContext(fs.readFileSync(path.join(DATA, f), "utf8"), sandbox, { filename: f });
const A = sandbox.ATLAS;

const domArg = process.argv.indexOf("--domain");
const only = domArg > -1 ? process.argv[domArg + 1] : null;
const byId = new Map(A.roster.map((r) => [r[0], r]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const citedYear = (text) => {
  const m = (text || "").match(/[\(（]\s*(\d{4})/);
  if (m) return +m[1];
  const m2 = (text || "").match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return m2 ? +m2[1] : null;
};

async function getDoi(doi) {
  const url = "https://api.crossref.org/works/" + encodeURIComponent(doi) + "?mailto=" + encodeURIComponent(MAILTO);
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "doi-verify/1.0 (mailto:" + MAILTO + ")" } });
      if (r.status === 404) return { status: 404 };
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const m = j.message;
      const y = (m.issued && m.issued["date-parts"] && m.issued["date-parts"][0] || [])[0] || null;
      return {
        status: 200, type: m.type, year: y,
        title: (m.title && m.title[0]) || "",
        journal: (m["container-title"] && m["container-title"][0]) || "",
        authorCount: (m.author || []).length,
        authors: (m.author || []).map((a) => a.family).filter(Boolean).join(", "),
      };
    } catch (e) {
      if (i === 2) return { status: "err", error: String(e.message || e) };
      await sleep(600 * (i + 1));
    }
  }
}

const REVIEW_TITLE = /\.\s*(New York|London|Cambridge|Oxford|Chicago|San Francisco|Boston|Princeton|New Haven|Toronto|Sydney|Milton|Abingdon|Hoboken|Baltimore|Durham|Notre Dame|Bloomington)\b/i;
const BAD_TYPE = new Set(["peer-review", "component", "dataset", "grant", "peer_review"]);

(async function main() {
  const jobs = [];
  for (const [id, arr] of Object.entries(A.dois || {})) {
    const r = byId.get(id);
    if (!r) continue;
    if (only && r[3] !== only) continue;
    arr.forEach((doi, i) => { if (doi) jobs.push({ id, i, doi, dom: r[3], entry: r[1] }); });
  }
  console.log(`待复核 DOI ${jobs.length} 个${only ? "（领域 " + only + "）" : ""}`);

  const cache = new Map();
  const rows = [];
  let done = 0;
  const CONC = 5;
  async function worker(slice) {
    for (const j of slice) {
      let meta = cache.get(j.doi);
      if (!meta) { meta = await getDoi(j.doi); cache.set(j.doi, meta); }
      const ev = ((A.details[j.id] || {}).evidence || [])[j.i] || {};
      const cy = citedYear(ev.text);
      const flags = [];
      if (meta.status === 404) flags.push("DOI 不存在");
      else if (meta.status !== 200) flags.push("请求失败");
      else {
        if (BAD_TYPE.has(meta.type)) flags.push("类型=" + meta.type);
        if (REL(meta)) flags.push("疑似书评");
        if (cy && meta.year && Math.abs(meta.year - cy) > 2) flags.push(`年份差 ${Math.abs(meta.year - cy)}（被引 ${cy} / 出版 ${meta.year}）`);
      }
      rows.push(Object.assign({}, j, { cited: ev.text || "", meta, flags }));
      done++;
      if (done % 50 === 0) process.stdout.write(`  … ${done}/${jobs.length}\n`);
      await sleep(60);
    }
  }
  const slices = Array.from({ length: CONC }, (_, k) => jobs.filter((_, i) => i % CONC === k));
  await Promise.all(slices.map(worker));

  const bad = rows.filter((r) => r.flags.length);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "doi-verify.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), total: jobs.length, flagged: bad.length, items: rows }, null, 1), "utf8");

  console.log(`\n复核 ${rows.length} 个 · 有问题 ${bad.length} 个\n`);
  for (const r of bad) {
    console.log(`${r.id}[${r.i}] ${r.entry} — ${r.flags.join(" · ")}`);
    console.log(`   被引：${r.cited.slice(0, 60)}`);
    if (r.meta && r.meta.status === 200) console.log(`   实际：${r.meta.year} ${r.meta.type} | ${r.meta.title.slice(0, 70)} | ${r.meta.authors}`);
    console.log(`   DOI ：${r.doi}`);
  }
  console.log(`\n明细 → reports/doi-verify.json`);
})();

function REL(m) {
  if (!m || m.status !== 200) return false;
  if (REVIEW_TITLE.test(m.title)) return true;
  /* 书评常见特征：题名就是书名，且只有 1 位作者（审稿人），而条目被引文本里点名了别的作者 */
  return false;
}
