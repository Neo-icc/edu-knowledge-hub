/* ============================================================
   全域体检：五个领域逐条核对
   读 practice/js/data/*.js（与 index.src.html 同序），输出结构化审计结果
   用法：node scripts/audit-all.js [--json]
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "practice", "js", "data");

/* 与 practice/index.src.html 完全一致的加载顺序（顺序影响 concat / assign） */
const ORDER = [
  "domains.js", "roster-1.js", "roster-2.js", "roster-3.js",
  "entries-d1.js", "entries-d2.js", "entries-d3.js", "entries-d4.js", "entries-d5.js",
  "dois.js", "thinkers.js", "scholars-extra.js", "overrides.js",
  "scenarios.js", "activities.js", "triage.js",
  "connections-1.js", "connections-2.js", "connections-3.js", "connections-4.js",
  "dom-9-dev.js", "dom-6-foundation.js", "dom-7-psych.js", "dom-8-broad.js", "dom-10-brain.js",
  "connections-5.js", "connections-6.js",
];

const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ORDER) {
  const p = path.join(DATA, f);
  const code = fs.readFileSync(p, "utf8");
  try {
    vm.runInContext(code, sandbox, { filename: f });
  } catch (e) {
    console.error(`!! 加载失败 ${f}: ${e.message}`);
    process.exit(1);
  }
}

const A = sandbox.ATLAS;
const roster = A.roster || [];
const details = A.details || {};
const linksRaw = A.links || [];
const dois = A.dois || {};
const domains = A.domains || [];

/* 与 practice/index.src.html 内联规范化一致：同一配对 + 同一类型只保留首次出现。
   页面实际渲染与统计用的是去重后的集合，体检必须以它为准。 */
const seenKey = new Set();
const links = [];
for (const l of linksRaw) {
  const k = [l[0], l[1]].sort().join("|") + "|" + l[2];
  if (!seenKey.has(k)) { seenKey.add(k); links.push(l); }
}
const dupLinks = linksRaw.length - links.length;

/* ---------- 基础索引 ---------- */
const byId = new Map();
const dupIds = [];
for (const r of roster) {
  const [id, name, en, dom, branch, person, year, kind, one] = r;
  if (byId.has(id)) dupIds.push(id);
  byId.set(id, { id, name, en, dom, branch, person, year, kind, one });
}

const deg = new Map();
const linkRefBad = [];
for (const [a, b] of links) {
  if (!byId.has(a) || !byId.has(b)) { linkRefBad.push([a, b]); continue; }
  deg.set(a, (deg.get(a) || 0) + 1);
  deg.set(b, (deg.get(b) || 0) + 1);
}

/* ---------- 证据分级（与 practice/js/app.js 的 evTier 保持同一规则） ----------
   doi    → 有 DOI，可直达原文
   ref    → 标注了具体作品（书名号 / 英文题名 / 期刊名），可据此定位
   trace  → 只有作者与年份，无法定位到具体文献
   review → 概括性表述
   注意：DOI 率不是质量指标。一手经典（《理想国》）本来就没有 DOI，
   用 DOI 率衡量基础理论会得出「1.2%，很差」的错误结论——要看「可定位率」。 */
const hasWork = (t) =>
  /《[^》]+》/.test(t) ||
  /[A-Za-z]{3,}([\s,&-]+[A-Za-z]{2,}){2,}/.test(t) ||
  /(Journal|Review|Press|学报|期刊|出版社|杂志)/.test(t);
const evTier = (ev, doi) =>
  doi ? "doi" : hasWork(ev.text || "") ? "ref" : (/\d{4}/.test(ev.text || "") ? "trace" : "review");

function tierOf(id) {
  const t = { doi: 0, ref: 0, trace: 0, review: 0 };
  const dt = details[id] || {};
  const mapped = dois[id] || [];
  (dt.evidence || []).forEach((ev, i) => { t[evTier(ev, mapped[i])] += 1; });
  return t;
}

/* ---------- 领域 / 分支维度 ---------- */
const domStat = [];
const branchStat = [];
for (const d of domains) {
  const ents = roster.filter(r => r[3] === d.id);
  let dLinks = 0, dDoi = 0, dEv = 0, dDetail = 0, dOrphan = 0;
  const dTier = { doi: 0, ref: 0, trace: 0, review: 0 };
  for (const r of ents) {
    const id = r[0];
    dLinks += deg.get(id) || 0;
    const dt = details[id];
    if (dt) {
      dDetail++;
      const ev = (dt.evidence || []).length;
      dEv += ev;
      const mapped = (dois[id] || []).filter(Boolean).length;
      dDoi += mapped;
    }
    const t = tierOf(id);
    for (const k of Object.keys(dTier)) dTier[k] += t[k];
    if (!(deg.get(id) || 0)) dOrphan++;
  }
  domStat.push({
    id: d.id, name: d.name, branches: d.branches.length,
    entries: ents.length, links: dLinks, detail: dDetail,
    evidence: dEv, doi: dDoi, orphan: dOrphan, tier: dTier,
    avgDeg: ents.length ? +(dLinks * 2 / ents.length).toFixed(2) : 0,
    fracCover: dEv ? +(dDoi / dEv * 100).toFixed(1) : 0,
    /* 可定位率 = (DOI + 有出处) / 证据数，这才是这一层的质量口径 */
    locatable: dEv ? +(((dTier.doi + dTier.ref) / dEv) * 100).toFixed(1) : 0,
  });

  for (const b of d.branches) {
    const be = roster.filter(r => r[3] === d.id && r[4] === b.id);
    let bLinks = 0, bDoi = 0, bEv = 0, bOrphan = 0;
    for (const r of be) {
      bLinks += deg.get(r[0]) || 0;
      const dt = details[r[0]];
      if (dt) {
        bEv += (dt.evidence || []).length;
        bDoi += (dois[r[0]] || []).filter(Boolean).length;
      }
      if (!(deg.get(r[0]) || 0)) bOrphan++;
    }
    branchStat.push({
      dom: d.id, domName: d.name, id: b.id, name: b.name,
      entries: be.length, links: bLinks, evidence: bEv, doi: bDoi, orphan: bOrphan,
    });
  }
}

/* ---------- 未登记条目：roster 有、details 有，但领域/分支对不上 ---------- */
const knownBranch = new Set();
for (const d of domains) for (const b of d.branches) knownBranch.add(d.id + "/" + b.id);
const badBranch = roster.filter(r => !knownBranch.has(r[3] + "/" + r[4]))
  .map(r => ({ id: r[0], name: r[1], dom: r[3], branch: r[4] }));

/* ---------- 有详情但不在花名册 / 有 DOI 但无条目 ---------- */
const detailNoRoster = Object.keys(details).filter(id => !byId.has(id));
const doiNoRoster = Object.keys(dois).filter(id => !byId.has(id));

/* ---------- 条目级缺口：无连接 / 无详情 / 无证据 / 无 DOI ---------- */
const noDetail = roster.filter(r => !details[r[0]]).map(r => ({ id: r[0], name: r[1], dom: r[3] }));
const noLink = roster.filter(r => !(deg.get(r[0]) || 0)).map(r => ({ id: r[0], name: r[1], dom: r[3], branch: r[4] }));
const noEvidence = roster.filter(r => details[r[0]] && !(details[r[0]].evidence || []).length)
  .map(r => ({ id: r[0], name: r[1], dom: r[3] }));
const noDoi = roster.filter(r => {
  const dt = details[r[0]];
  if (!dt) return false;
  const ev = (dt.evidence || []).length;
  return ev > 0 && !(dois[r[0]] || []).some(Boolean);
}).map(r => ({ id: r[0], name: r[1], dom: r[3], ev: (details[r[0]].evidence || []).length }));

/* ---------- 链接类型 / 置信度分布 ---------- */
const linkType = {}, conf = {};
for (const l of links) {
  linkType[l[2]] = (linkType[l[2]] || 0) + 1;
  conf[l[4]] = (conf[l[4]] || 0) + 1;
}

/* ---------- 场景覆盖：每个领域被多少场景引用 ---------- */
const scenDom = {};
for (const s of (A.scenarios || [])) {
  const ids = s.entries || s.entryIds || [];
  const set = new Set();
  for (const id of ids) { const r = byId.get(id); if (r) set.add(r.dom); }
  for (const d of set) scenDom[d] = (scenDom[d] || 0) + 1;
}

const report = {
  meta: A.meta,
  totals: {
    domains: domains.length,
    branches: domains.reduce((s, d) => s + d.branches.length, 0),
    entries: roster.length,
    links: links.length,
    linksRaw: linksRaw.length,
    dupLinks,
    withDetail: Object.keys(details).length,
    withDoi: Object.values(dois).filter(a => a.some(Boolean)).length,
    scenarios: (A.scenarios || []).length,
    activities: Object.keys(A.activities || {}).length,
    thinkers: Object.keys(A.scholars || {}).length,
  },
  integrity: {
    dupIds, linkRefBad: linkRefBad.slice(0, 20), linkRefBadCount: linkRefBad.length,
    detailNoRoster, doiNoRoster, badBranch,
  },
  domStat, branchStat, linkType, conf, scenDom,
  gaps: { noDetail, noLink, noEvidence, noDoi },
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 1));
  process.exit(0);
}

/* ---------- 可读输出 ---------- */
const pct = (a, b) => b ? (a / b * 100).toFixed(0) + "%" : "-";
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

console.log("\n===== 全域体检 · 教育与心智知识图谱 =====\n");
console.log(`条目 ${report.totals.entries} · 关联 ${report.totals.links}（原始 ${report.totals.linksRaw}，同配对同类型重复 ${report.totals.dupLinks}）· 详情 ${report.totals.withDetail} · 场景 ${report.totals.scenarios} · 人物 ${report.totals.thinkers}`);
console.log(`领域 ${report.totals.domains} · 分支 ${report.totals.branches}\n`);

console.log("【领域总览】");
console.log(pad("领域", 14) + lpad("条目", 6) + lpad("关联", 7) + lpad("均度", 7) + lpad("证据", 7) + lpad("DOI", 6) + lpad("有出处", 8) + lpad("仅作者年", 9) + lpad("可定位率", 10));
for (const d of domStat) {
  console.log(pad(d.name, 14) + lpad(d.entries, 6) + lpad(d.links, 7) +
    lpad(d.avgDeg, 7) + lpad(d.evidence, 7) + lpad(d.tier.doi, 6) + lpad(d.tier.ref, 8) +
    lpad(d.tier.trace, 9) + lpad(d.locatable + "%", 10));
}
const TT = domStat.reduce((a, d) => {
  for (const k of Object.keys(a)) a[k] += d.tier[k];
  return a;
}, { doi: 0, ref: 0, trace: 0, review: 0 });
const TOT = TT.doi + TT.ref + TT.trace + TT.review;
console.log(pad("合计", 14) + lpad("", 6) + lpad("", 7) + lpad("", 7) + lpad(TOT, 7) +
  lpad(TT.doi, 6) + lpad(TT.ref, 8) + lpad(TT.trace, 9) +
  lpad(((TT.doi + TT.ref) / TOT * 100).toFixed(1) + "%", 10));
console.log("  说明：DOI 率不是质量指标。一手经典（《理想国》《大教学论》）没有 DOI，");
console.log("        若只看 DOI 率会把基础理论误判为最差；「可定位率」才是这一层的口径。");

console.log("\n【分支空缺：条目 ≤ 3 或 关联 = 0】");
const weak = branchStat.filter(b => b.entries <= 3 || b.links === 0)
  .sort((a, b) => a.entries - b.entries || a.links - b.links);
for (const b of weak) {
  console.log(`  ${pad(b.domName, 12)} ${pad(b.name, 20)} 条目 ${lpad(b.entries, 3)}  关联 ${lpad(b.links, 3)}  证据 ${lpad(b.evidence, 2)}  DOI ${lpad(b.doi, 2)}`);
}
if (!weak.length) console.log("  （无）");

console.log("\n【完整性】");
console.log(`  重复 ID: ${dupIds.length ? dupIds.join(", ") : "无"}`);
console.log(`  关联指向不存在的条目: ${linkRefBad.length}`);
console.log(`  详情无花名册: ${detailNoRoster.length ? detailNoRoster.join(", ") : "无"}`);
console.log(`  DOI 无花名册: ${doiNoRoster.length ? doiNoRoster.join(", ") : "无"}`);
console.log(`  领域/分支对不上: ${badBranch.length ? badBranch.map(x => x.id + "(" + x.dom + "/" + x.branch + ")").join(", ") : "无"}`);

console.log("\n【缺口统计】");
console.log(`  无详情条目: ${noDetail.length}  → ${noDetail.slice(0, 12).map(x => x.id).join(", ")}${noDetail.length > 12 ? " …" : ""}`);
console.log(`  无任何关联: ${noLink.length}  → ${noLink.slice(0, 12).map(x => x.id + " " + x.name).join(" | ")}${noLink.length > 12 ? " …" : ""}`);
console.log(`  有详情无证据: ${noEvidence.length}`);
console.log(`  有证据无 DOI: ${noDoi.length}`);

console.log("\n【关联类型】");
for (const [k, v] of Object.entries(linkType).sort((a, b) => b[1] - a[1])) console.log(`  ${pad(k, 14)} ${lpad(v, 4)}`);
console.log("\n【置信度】");
for (const [k, v] of Object.entries(conf).sort((a, b) => b[1] - a[1])) console.log(`  ${pad(k, 14)} ${lpad(v, 4)}`);
console.log("");
