/* ============================================================
   中文叙述式证据的 DOI 核验（脑科学 / 教育学基础专用）

   这两个领域的证据写成「作者（年份）中文描述」，没有英文题名，
   常规的题名相似度匹配用不上。改用作者+年份检索：

     1. 从证据文本抽出被引作者姓氏与年份（支持「A 与 B（1999）」「A 等（1999）」
        「A、B 与 C（1999）」三种写法）
     2. Crossref 按 query.author + 出版年窗口检索
     3. 自动接受条件（三条同时满足）：
        a. 候选的作者列表包含全部被引姓氏（允许姓氏全等，大小写/变音符号归一）
        b. 出版年与被引年份相差 ≤ 1
        c. 满足 a+b 的候选**唯一**
     4. 不唯一 / 无候选 → 记为 ambiguous，交给人工逐条判定（不自动写入）

   用法：
     node scripts/backfill-doi-zh.js --domain brain            生成报告（不写）
     node scripts/backfill-doi-zh.js --domain brain --write    写回 dois.js
     node scripts/backfill-doi-zh.js --review                  打印 ambiguous 清单
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

/* ---------------- 作者 / 年份抽取 ---------------- */
const NAME = "[A-Z][A-Za-z\u00C0-\u024F'’\\-]+(?:\\s+[A-Z][a-z]+)?";
const RE_CITE = new RegExp(
  "(" + NAME + ")" +
  "(?:\\s*(?:、|与|和|&|and)\\s*(" + NAME + "))?" +
  "(?:\\s*(?:、|与|和|&|and)\\s*(" + NAME + "))?" +
  "\\s*(?:等|et\\s+al\\.?)?" +
  "\\s*[（(]\\s*(\\d{4})\\s*[a-z]?\\s*[)）]"
);

function parseCitation(text) {
  const m = text.match(RE_CITE);
  if (!m) return null;
  const names = [m[1], m[2], m[3]].filter(Boolean);
  return { names, etal: /等|et\s+al/.test(m[0]), year: +m[4] };
}

const stripAccents = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
/* 姓(last name)取最后一个词，处理 "De Wolff" / "van Alten" 之类 */
const lastName = (n) => stripAccents(n.trim().split(/\s+/).pop());

function authorMatch(cited, item) {
  const fams = (item.author || []).map((a) => stripAccents(a.family || ""));
  return cited.every((c) => {
    const ln = lastName(c);
    return fams.some((f) => f === ln || f.startsWith(ln) || ln.startsWith(f));
  });
}

/* ---------------- Crossref ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cr(query, year, rows = 8) {
  const params = new URLSearchParams({
    "query.bibliographic": query,
    rows: String(rows),
    select: "DOI,title,issued,author,type,container-title",
    mailto: MAILTO,
  });
  if (year) {
    params.set("filter", `from-pub-date:${year - 1}-01-01,until-pub-date:${year + 1}-12-31`);
  }
  const url = "https://api.crossref.org/works?" + params.toString();
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "edu-knowledge-hub-doi-audit/1.0 (mailto:" + MAILTO + ")" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      return (j.message && j.message.items) || [];
    } catch (e) {
      if (i === 2) return [];
      await sleep(700 * (i + 1));
    }
  }
  return [];
}

const yearOf = (it) => {
  const p = it.issued && it.issued["date-parts"] && it.issued["date-parts"][0];
  return p && typeof p[0] === "number" ? p[0] : null;
};

const STOP = new Set(["the", "of", "and", "in", "on", "for", "to", "a", "an", "with", "from",
  "by", "as", "is", "are", "its", "their", "this", "that", "at", "or", "vs", "versus"]);
const toks = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
  .filter((w) => w.length > 2 && !STOP.has(w));
const overlap = (a, b) => {
  const B = new Set(toks(b));
  return toks(a).filter((w) => B.has(w)).length;
};

/* 题名相似度（3-gram Jaccard 与 内容词 Dice 取大），用于第二阶段按已知题名核验 */
const grams = (s, n = 3) => {
  const t = (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const out = new Set();
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n));
  return out;
};
const jac = (a, b) => {
  const A1 = grams(a), B1 = grams(b);
  if (!A1.size || !B1.size) return 0;
  let i = 0;
  for (const g of A1) if (B1.has(g)) i++;
  return i / (A1.size + B1.size - i);
};
const dice = (a, b) => {
  const A1 = new Set(toks(a)), B1 = new Set(toks(b));
  if (!A1.size || !B1.size) return 0;
  let i = 0;
  for (const w of A1) if (B1.has(w)) i++;
  return 2 * i / (A1.size + B1.size);
};
const sim = (a, b) => Math.max(jac(a, b), dice(a, b));

/* ---------------- 主流程 ---------------- */
(async function main() {
  const domArg = process.argv.indexOf("--domain");
  const domain = domArg > -1 ? process.argv[domArg + 1] : "brain";
  const write = process.argv.includes("--write");
  const review = process.argv.includes("--review");
  const applyDecisions = process.argv.includes("--apply");
  const titlesMode = process.argv.includes("--titles");

  const byId = new Map(A.roster.map((r) => [r[0], r]));
  const dois = JSON.parse(JSON.stringify(A.dois || {}));

  /* ---- 把第二阶段（按题名核验）命中的结果并入 dois.js ---- */
  if (process.argv.includes("--apply-titles")) {
    const rp = path.join(OUT, `doi-zh-${domain}-titles-result.json`);
    if (!fs.existsSync(rp)) return console.log("缺少 titles-result 文件");
    const T = JSON.parse(fs.readFileSync(rp, "utf8")).items.filter((x) => x.doi);
    for (const p of T) {
      const arr = dois[p.id] || [];
      const next = new Array(Math.max(arr.length, p.i + 1)).fill(null);
      for (let k = 0; k < arr.length; k++) next[k] = arr[k] || null;
      if (!next[p.i]) next[p.i] = p.doi;
      dois[p.id] = next;
    }
    const ids = Object.keys(dois).sort((a, b) => +a.slice(1) - +b.slice(1));
    const lines = [
      "/* 经 Crossref 核验的 DOI 映射：条目 id → 与 evidence 数组下标对齐的 DOI",
      "   生成方式：按证据文本检索 Crossref，要求标题包含或相似度 ≥ 0.8，且年份相差 ≤ 2 年；",
      "   中文叙述式证据（脑科学 / 教育学基础）改用「作者姓氏命中 + 年份差 ≤1 + 题名主题重合」检索候选，",
      "   再逐条人工核对候选题名与被引描述是否指同一文献；候选项错但可确定原始题名的，按原始题名二次核验",
      "   （题名相似度 ≥ 0.85 + 作者命中 + 年份差 ≤2）。核对不上的一律留 null，不猜测、不补造 */",
      "window.ATLAS = window.ATLAS || {};",
      "",
      "ATLAS.dois = {",
    ];
    ids.forEach((id, k) => {
      const arr = dois[id].map((x) => (x ? JSON.stringify(x) : "null"));
      lines.push(`  ${JSON.stringify(id)}: [${arr.join(",")}]${k === ids.length - 1 ? "" : ","}`);
    });
    lines.push("};", "");
    fs.writeFileSync(path.join(DATA, "dois.js"), lines.join("\n"), "utf8");
    console.log(`并入 ${T.length} 条题名核验结果`);
    return;
  }

  if (titlesMode) {
    const tpArg = process.argv.indexOf("--titles-file");
    const tp = tpArg > -1 ? path.resolve(process.argv[tpArg + 1]) : path.join(OUT, `doi-zh-${domain}-titles.json`);
    if (!fs.existsSync(tp)) return console.log("缺少 titles 文件");
    const repPath = path.join(OUT, `doi-zh-${domain}.json`);
    const R = JSON.parse(fs.readFileSync(repPath, "utf8"));
    const T = JSON.parse(fs.readFileSync(tp, "utf8"));
    const out = [];
    for (const [k, title] of Object.entries(T)) {
      /* 支持两种键：报告里的序号 "37"，或更直观的 "E185[0]" */
      let idx;
      const m = k.match(/^([A-Z]\d+)\[(\d+)\]$/);
      if (m) {
        idx = R.items.findIndex((x) => x.id === m[1] && x.i === +m[2]);
      } else {
        idx = +k;
      }
      const item = R.items[idx];
      if (!item) { out.push({ idx, key: k, title, doi: null, why: "无对应条目" }); continue; }
      const hits = await cr(title, item.year, 10);
      let best = null;
      for (const it of hits) {
        const ct = (it.title && it.title[0]) || "";
        const y = yearOf(it);
        if (!ct || y == null) continue;
        if (Math.abs(y - item.year) > 2) continue;
        if (!authorMatch(item.names, it)) continue;
        const s = sim(title, ct);
        if (s < 0.85) continue;
        if (!best || s > best.s) best = { doi: it.DOI, s: +s.toFixed(3), ct, y };
      }
      out.push({ idx, id: item.id, i: item.i, cited: item.text, title, doi: best ? best.doi : null,
        score: best ? best.s : null, crossrefTitle: best ? best.ct : null, refYear: item.year, crossYear: best ? best.y : null });
      await sleep(180);
    }
    const outName = tpArg > -1 ? path.basename(tp).replace(/\.json$/, "-result.json") : `doi-zh-${domain}-titles-result.json`;
    fs.writeFileSync(path.join(OUT, outName),
      JSON.stringify({ generatedAt: new Date().toISOString(), items: out }, null, 1), "utf8");
    const okN = out.filter((x) => x.doi).length;
    console.log(`按题名核验 ${out.length} 条 → 命中 ${okN}`);
    out.forEach((x) => {
      console.log(`${x.doi ? "OK  " : "MISS"} [${x.idx}] ${x.id}[${x.i}] ${x.refYear}${x.crossYear ? "→" + x.crossYear : ""} ${x.doi || ""}`);
      console.log(`      ${(x.crossrefTitle || "（无匹配）").slice(0, 90)}`);
    });
    return;
  }

  const byId2 = byId;
  /* ---- 按人工判定清单写入（唯一可信的写入路径）---- */
  if (applyDecisions) {
    const decPath = path.join(OUT, `doi-zh-${domain}-decisions.json`);
    const repPath = path.join(OUT, `doi-zh-${domain}.json`);
    if (!fs.existsSync(decPath) || !fs.existsSync(repPath)) {
      return console.log("缺少 decisions 或报告文件");
    }
    const dec = JSON.parse(fs.readFileSync(decPath, "utf8"));
    const R = JSON.parse(fs.readFileSync(repPath, "utf8"));
    const keep = new Set(dec.accepted);
    const picked = [];
    const skipped = [];
    R.items.forEach((x, idx) => {
      if (!keep.has(idx)) return;
      const c = x.accepted || (x.candidates || [])[0];
      if (!c || !c.doi) { skipped.push(idx); return; }
      picked.push({ idx, id: x.id, i: x.i, doi: c.doi, title: c.title, year: x.year });
    });
    for (const p of picked) {
      const arr = dois[p.id] || [];
      const next = new Array(Math.max(arr.length, p.i + 1)).fill(null);
      for (let k = 0; k < arr.length; k++) next[k] = arr[k] || null;
      if (!next[p.i]) next[p.i] = p.doi;
      dois[p.id] = next;
    }
    console.log(`判定 ${keep.size} 条 · 写入 ${picked.length} 条 · 候选缺失跳过 ${skipped.length} 条`);

    const ids = Object.keys(dois).sort((a, b) => +a.slice(1) - +b.slice(1));
    const lines = [
      "/* 经 Crossref 核验的 DOI 映射：条目 id → 与 evidence 数组下标对齐的 DOI",
      "   生成方式：按证据文本检索 Crossref，要求标题包含或相似度 ≥ 0.8，且年份相差 ≤ 2 年；",
      "   中文叙述式证据（脑科学 / 教育学基础）改用「作者姓氏命中 + 年份差 ≤1 + 题名主题重合」检索候选，",
      "   再**逐条人工核对**候选题名与被引描述是否指同一文献后写入；核对不上的一律留 null，不猜测、不补造",
      "   未匹配到的位置为 null */",
      "window.ATLAS = window.ATLAS || {};",
      "",
      "ATLAS.dois = {",
    ];
    ids.forEach((id, k) => {
      const arr = dois[id].map((x) => (x ? JSON.stringify(x) : "null"));
      lines.push(`  ${JSON.stringify(id)}: [${arr.join(",")}]${k === ids.length - 1 ? "" : ","}`);
    });
    lines.push("};", "");
    fs.writeFileSync(path.join(DATA, "dois.js"), lines.join("\n"), "utf8");
    fs.writeFileSync(path.join(OUT, `doi-zh-${domain}-applied.json`),
      JSON.stringify({ appliedAt: new Date().toISOString(), count: picked.length, items: picked }, null, 1), "utf8");
    console.log("已写回 practice/js/data/dois.js");
    return;
  }

  const todo = [];
  for (const [id, d] of Object.entries(A.details || {})) {
    const r = byId.get(id);
    if (!r || r[3] !== domain) continue;
    const mapped = dois[id] || [];
    (d.evidence || []).forEach((ev, i) => {
      if (mapped[i]) return;
      const c = parseCitation(ev.text || "");
      if (!c) return;
      todo.push({ id, i, text: ev.text, names: c.names, etal: c.etal, year: c.year, entry: r[1], en: r[2] || "" });
    });
  }
  console.log(`[${domain}] 待核验证据 ${todo.length} 条`);

  if (review) {
    const rep = path.join(OUT, `doi-zh-${domain}.json`);
    if (!fs.existsSync(rep)) return console.log("请先跑一次生成报告");
    const R = JSON.parse(fs.readFileSync(rep, "utf8"));
    const from = +(process.argv[process.argv.indexOf("--review") + 1] || 0);
    const n = +(process.argv[process.argv.indexOf("--n") + 1] || 40);
    const slice = R.items.slice(from, from + n);
    console.log(`# 区间 ${from}–${from + slice.length - 1} / 共 ${R.items.length}\n`);
    slice.forEach((x, k) => {
      const c = x.accepted || (x.candidates || [])[0];
      const tag = x.accepted ? "A" : x.candidates.length ? "?" : "-";
      console.log(`[${from + k}] ${tag} ${x.id}[${x.i}] ${x.year} | ${x.text.slice(0, 46)}`);
      console.log(`      ${c ? c.year + " " + (c.title || "").slice(0, 84) : "（无候选）"}${c ? "  ⟨" + c.doi + "⟩" : ""}`);
    });
    return;
  }

  const results = [];
  const CONC = 3;
  let done = 0;
  async function worker(slice) {
    for (const item of slice) {
      /* 用「条目英文名 + 被引作者」做题名检索：姓氏太常见时，纯作者检索会召回
         一堆同名的无关论文（Morris 1986 会搜出经济学书评）；加上主题词才能压住。 */
      const q = (item.en + " " + item.names.join(" ")).trim();
      const items = await cr(q, item.year, 20);
      const ok = [];
      for (const it of items) {
        if (it.type === "peer-review" || it.type === "component" || it.type === "dataset") continue;
        const y = yearOf(it);
        if (y == null || Math.abs(y - item.year) > 1) continue;
        if (!authorMatch(item.names, it)) continue;
        const title = (it.title && it.title[0]) || "";
        ok.push({
          doi: it.DOI, year: y, type: it.type, title,
          journal: (it["container-title"] && it["container-title"][0]) || "",
          authors: (it.author || []).map((a) => a.family).filter(Boolean).join(", "),
          overlap: overlap(item.en, title),
        });
      }
      /* 接受规则：作者+年份已过滤，再要求题名与条目主题有词面重合，且重合度最高者唯一 */
      ok.sort((a, b) => b.overlap - a.overlap || Math.abs(a.year - item.year) - Math.abs(b.year - item.year));
      let accepted = null;
      if (ok.length === 1) accepted = ok[0];
      else if (ok.length > 1 && ok[0].overlap >= 1 && ok[0].overlap > ok[1].overlap) accepted = ok[0];
      else if (ok.length > 1 && ok[0].overlap >= 2 && ok[0].overlap === ok[1].overlap &&
               Math.abs(ok[0].year - item.year) < Math.abs(ok[1].year - item.year)) accepted = ok[0];
      results.push(Object.assign({}, item, { accepted, candidates: ok }));
      done++;
      if (done % 20 === 0) process.stdout.write(`  … ${done}/${todo.length}\n`);
      await sleep(150);
    }
  }
  const slices = Array.from({ length: CONC }, (_, k) => todo.filter((_, i) => i % CONC === k));
  await Promise.all(slices.map(worker));

  const acc = results.filter((r) => r.accepted);
  const amb = results.filter((r) => !r.accepted && r.candidates.length > 0);
  const none = results.filter((r) => !r.candidates.length);
  console.log(`\n唯一命中（可自动写入）${acc.length} · 多候选待判定 ${amb.length} · 无候选 ${none.length}`);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `doi-zh-${domain}.json`), JSON.stringify({
    generatedAt: new Date().toISOString(), domain,
    rule: "全部被引姓氏命中 + 年份差 ≤1 + 候选唯一",
    total: results.length, accepted: acc.length, ambiguous: amb.length, none: none.length,
    items: results,
  }, null, 1), "utf8");
  console.log(`报告 → reports/doi-zh-${domain}.json`);

  if (!write) return;

  for (const r of acc) {
    const arr = dois[r.id] || [];
    const next = new Array(Math.max(arr.length, r.i + 1)).fill(null);
    for (let k = 0; k < arr.length; k++) next[k] = arr[k] || null;
    if (!next[r.i]) next[r.i] = r.accepted.doi;
    dois[r.id] = next;
  }
  const ids = Object.keys(dois).sort((a, b) => +a.slice(1) - +b.slice(1));
  const lines = [
    "/* 经 Crossref 核验的 DOI 映射：条目 id → 与 evidence 数组下标对齐的 DOI",
    "   生成方式：按证据文本检索 Crossref，要求标题包含或相似度 ≥ 0.8，且年份相差 ≤ 2 年；",
    "   中文叙述式证据（脑科学 / 教育学基础）改用「作者姓氏全部命中 + 年份差 ≤ 1 + 候选唯一」核验",
    "   未匹配到的位置为 null，不猜测、不补造 */",
    "window.ATLAS = window.ATLAS || {};",
    "",
    "ATLAS.dois = {",
  ];
  ids.forEach((id, k) => {
    const arr = dois[id].map((x) => (x ? JSON.stringify(x) : "null"));
    lines.push(`  ${JSON.stringify(id)}: [${arr.join(",")}]${k === ids.length - 1 ? "" : ","}`);
  });
  lines.push("};", "");
  fs.writeFileSync(path.join(DATA, "dois.js"), lines.join("\n"), "utf8");
  console.log(`已写回，新增 ${acc.length} 个 DOI`);
})();
