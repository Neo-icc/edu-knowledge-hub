/* ============================================================
   DOI 回填：按项目既有约定核验 Crossref
   规则（与 dois.js 头部声明一致）：
     1. 证据文本中可抽出英文题名（Latin 连续片段）
     2. Crossref 题名相似度 ≥ 0.80
     3. 年份相差 ≤ 2 年（Crossref 无年份则视为不可核验，拒绝）
   不满足的位置保持 null —— 不猜测、不补造。

   用法：
     node scripts/backfill-doi.js              只体检，输出报告
     node scripts/backfill-doi.js --write      写回 practice/js/data/dois.js
     node scripts/backfill-doi.js --limit 20   限制条数（调试）
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

/* ---------------- 文本工具 ---------------- */
const STOP = new Set(["a", "an", "the", "of", "in", "on", "for", "to", "and", "or", "with",
  "from", "by", "at", "as", "is", "are", "its", "their", "this", "that", "et", "al"]);

const norm = (s) => s.toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

function tokens(s) {
  return norm(s).split(" ").filter(w => w.length > 1 && !STOP.has(w));
}

/* 内容词 Dice 系数 */
function dice(a, b) {
  const A1 = new Set(tokens(a)), B1 = new Set(tokens(b));
  if (!A1.size || !B1.size) return 0;
  let inter = 0;
  for (const w of A1) if (B1.has(w)) inter++;
  return 2 * inter / (A1.size + B1.size);
}

/* 字符级相似度（3-gram Jaccard），对短题名更宽容 */
function grams(s, n = 3) {
  const t = norm(s).replace(/ /g, "");
  const out = new Set();
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n));
  return out;
}
function jac(a, b) {
  const A1 = grams(a), B1 = grams(b);
  if (!A1.size || !B1.size) return 0;
  let inter = 0;
  for (const g of A1) if (B1.has(g)) inter++;
  return inter / (A1.size + B1.size - inter);
}
const similar = (a, b) => Math.max(dice(a, b), jac(a, b));

/* 覆盖率：查询题名的内容词有多少出现在候选题名里。
   证据文本里的题名常被作者截短（"The unity and diversity of executive functions"），
   此时 3-gram/Dice 都会虚低，用覆盖率判断「候选包含了我们的全部关键词」更合理。 */
function coverage(q, c) {
  const Q = new Set(tokens(q)), C = new Set(tokens(c));
  if (!Q.size) return 0;
  let hit = 0;
  for (const w of Q) if (C.has(w)) hit++;
  return hit / Q.size;
}

/* 反复剥掉开头的作者串："Miyake et al., " / "Wood, Bruner & Ross, " / "De Wolff & van IJzendoorn, " */
function stripAuthors(s) {
  for (let k = 0; k < 6; k++) {
    const m = s.match(/^([^,]{1,60}),\s*(.+)$/);
    if (!m) break;
    const head = m[1].trim();
    const wc = head.split(/\s+/).length;
    const authorish =
      wc <= 6 &&
      /^[A-Z][A-Za-z.\-'’]+/.test(head) &&
      /^[A-Za-z.&'’\-\s]+$/.test(head) &&
      !/^(the|a|an|on|of|in|for|toward|towards|from|how|why|what|when)$/i.test(head);
    if (!authorish) break;
    s = m[2].trim();
  }
  return s;
}

/* 从证据文本抽题名：书名号内的题名优先，其次取最长的 Latin 连续片段 */
function pickTitle(text) {
  /* ① 《…》是作者手工标注的题名，优先级最高（避免把期刊名当题名） */
  const quoted = text.match(/《([^》]{8,})》/);
  if (quoted) {
    const q = quoted[1].trim().replace(/[\s,;:.]+$/, "");
    if ((q.match(/[A-Za-z]{2,}/g) || []).length >= 3) return q;
  }
  const chunks = text.match(/[A-Za-z0-9][A-Za-z0-9 \-:'’&,\.\(\)\/]{12,}/g) || [];
  if (!chunks.length) return null;
  let best = "";
  for (const c of chunks) {
    const wc = (c.match(/[A-Za-z]{2,}/g) || []).length;
    if (wc >= 4 && c.length > best.length) best = c;
  }
  if (!best) return null;
  /* 去掉尾部年份括号与残留标点 */
  let t = best.replace(/[\(（]\s*\d{4}[a-z]?\s*[\)）]\s*$/i, "").replace(/[\s,;:.]+$/, "");
  t = stripAuthors(t);
  return t.trim().length >= 12 ? t.trim() : null;
}

/* 从证据文本抽年份：优先括号内，其次末尾裸年份 */
function pickYear(text) {
  const m1 = text.match(/[\(（]\s*(\d{4})[a-z]?\s*[\)）]/g);
  if (m1 && m1.length) {
    const y = m1[m1.length - 1].match(/(\d{4})/);
    if (y) return +y[1];
  }
  const m2 = text.match(/(\d{4})\s*[\)）]?\s*$/);
  if (m2) return +m2[1];
  const m3 = text.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return m3 ? +m3[1] : null;
}

const isEnglishish = (t) => (t.match(/[A-Za-z][A-Za-z'’\-]{2,}/g) || []).length >= 4;

/* ---------------- Crossref ---------------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* 人工复核后剔除：Crossref 记录实为「书评」而非原书，指向它会误导读者 */
const DENY_DOI = new Set([
  "10.5840/teachphil19869111", // Teaching Philosophy 1986，实为 Noddings《Caring》的书评
]);

async function crossref(query) {
  const url = "https://api.crossref.org/works?" +
    "query.bibliographic=" + encodeURIComponent(query) +
    "&rows=5&select=DOI,title,issued,type,container-title" +
    "&mailto=" + encodeURIComponent(MAILTO);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "edu-knowledge-hub-doi-audit/1.0 (mailto:" + MAILTO + ")" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      return (j.message && j.message.items) || [];
    } catch (e) {
      if (attempt === 2) return [];
      await sleep(800 * (attempt + 1));
    }
  }
  return [];
}

const yearOf = (item) => {
  const p = item.issued && item.issued["date-parts"] && item.issued["date-parts"][0];
  const y = p && p[0];
  return typeof y === "number" ? y : null;
};

/* ---------------- 主流程 ---------------- */
(async function main() {
  const write = process.argv.includes("--write");
  const limArg = process.argv.indexOf("--limit");
  const limit = limArg > -1 ? +process.argv[limArg + 1] : Infinity;

  const roster = A.roster || [];
  const byId = new Map(roster.map(r => [r[0], r]));
  const dois = JSON.parse(JSON.stringify(A.dois || {}));

  /* 收集待补位置 */
  const todo = [];
  for (const [id, d] of Object.entries(A.details || {})) {
    const mapped = dois[id] || [];
    (d.evidence || []).forEach((ev, i) => {
      const text = ev.text || "";
      if (mapped[i]) return;
      if (!isEnglishish(text)) return;
      const title = pickTitle(text);
      const year = pickYear(text);
      if (!title) return;
      todo.push({ id, i, text, title, year, dom: byId.get(id) ? byId.get(id)[3] : "?" });
    });
  }
  todo.sort((a, b) => (a.dom < b.dom ? -1 : a.dom > b.dom ? 1 : 0));
  const work = todo.slice(0, limit);

  console.log(`待核验证据位置 ${todo.length}${limit !== Infinity ? "（本轮处理 " + work.length + "）" : ""}`);

  const results = [];
  const CONC = 4;
  let done = 0;

  async function worker(slice) {
    for (const item of slice) {
      const items = await crossref(item.title + (item.year ? " " + item.year : ""));
      let best = null;
      const qWords = tokens(item.title).length;
      for (const it of items) {
        const cTitle = (it.title && it.title[0]) || "";
        const cYear = yearOf(it);
        if (!cTitle) continue;
        /* 书评 / 同行评议 / 组件不是原文，必须排除 */
        if (/^(book review|review of|review:|book review:)/i.test(cTitle.trim())) continue;
        if (it.type === "peer-review" || it.type === "component" || it.type === "dataset") continue;
        if (/\bbook review\b/i.test(cTitle)) continue;
        /* 书评在 Crossref 里常把「作者. 出版地: 出版社」塞进题名，需排除 */
        if (/\.\s*(New York|London|Cambridge|Oxford|Chicago|San Francisco|Boston|Princeton|New Haven|Toronto|Sydney|Milton|Abingdon|Hoboken|Baltimore|Durham)\b/i.test(cTitle)) continue;
        if (item.year == null || cYear == null) continue;
        if (DENY_DOI.has(it.DOI)) continue;
        const dy = Math.abs(cYear - item.year);
        if (dy > 2) continue;

        const cov = coverage(item.title, cTitle);
        const sim = similar(item.title, cTitle);
        const cWords = tokens(cTitle).length;
        /* 候选不能比查询长太多，否则「包含关键词」可能只是套了长综述 */
        const notPadded = cWords <= Math.max(qWords * 3, qWords + 10);

        let path = null;
        if (sim >= 0.8 && dice(item.title, cTitle) >= 0.5) path = "full-title";
        /* 截短题名：关键词几乎全覆盖 + 年份几乎精确 + 未过度加长 */
        else if (cov >= 0.95 && dy <= 1 && notPadded && qWords >= 4) path = "truncated-title";
        if (!path) continue;

        const rank = (path === "full-title" ? 2 : 1) * 1000 + cov * 100 + sim;
        if (!best || rank > best.rank) {
          best = {
            doi: it.DOI, path, score: +sim.toFixed(3), coverage: +cov.toFixed(3),
            crossrefTitle: cTitle, crossrefYear: cYear, type: it.type, rank,
          };
        }
      }
      results.push(Object.assign({}, item, { matched: best }));
      done++;
      if (done % 20 === 0) process.stdout.write(`  … ${done}/${work.length}\n`);
      await sleep(120);
    }
  }

  const slices = Array.from({ length: CONC }, (_, k) => work.filter((_, idx) => idx % CONC === k));
  await Promise.all(slices.map(worker));

  const hit = results.filter(r => r.matched);
  const miss = results.filter(r => !r.matched);
  console.log(`\n命中 ${hit.length} / ${results.length}（${(hit.length / results.length * 100).toFixed(1)}%）`);

  /* 按领域统计 */
  const byDom = {};
  for (const r of results) {
    byDom[r.dom] = byDom[r.dom] || { tot: 0, hit: 0 };
    byDom[r.dom].tot++;
    if (r.matched) byDom[r.dom].hit++;
  }
  for (const [k, v] of Object.entries(byDom)) console.log(`  ${k}: ${v.hit}/${v.tot}`);

  /* 写报告 */
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "doi-backfill.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    rule: "title similarity >= 0.80 && |year diff| <= 2",
    total: results.length, hit: hit.length, miss: miss.length,
    items: results,
  }, null, 1), "utf8");
  console.log(`报告 → reports/doi-backfill.json（未命中 ${miss.length} 条已列出，供人工核验）`);

  if (!write) return;

  /* 合并：只填原本为 null 的位置，已有值一律不动 */
  for (const r of hit) {
    const arr = dois[r.id] || [];
    const maxLen = Math.max(arr.length, r.i + 1);
    const next = new Array(maxLen).fill(null);
    for (let k = 0; k < arr.length; k++) next[k] = arr[k] || null;
    if (!next[r.i]) next[r.i] = r.matched.doi;
    dois[r.id] = next;
  }

  /* 重新序列化 dois.js（保持 id 升序，格式与原文件一致） */
  const ids = Object.keys(dois).sort((a, b) => {
    const na = +a.slice(1), nb = +b.slice(1);
    return na - nb;
  });
  const lines = [];
  lines.push("/* 经 Crossref 核验的 DOI 映射：条目 id → 与 evidence 数组下标对齐的 DOI");
  lines.push("   生成方式：按证据文本检索 Crossref，要求标题包含或相似度 ≥ 0.8，且年份相差 ≤ 2 年");
  lines.push("   未匹配到的位置为 null，不猜测、不补造 */");
  lines.push("window.ATLAS = window.ATLAS || {};");
  lines.push("");
  lines.push("ATLAS.dois = {");
  ids.forEach((id, k) => {
    const arr = dois[id].map(x => (x ? JSON.stringify(x) : "null"));
    const tail = k === ids.length - 1 ? "" : ",";
    if (arr.length === 1) {
      lines.push(`  ${JSON.stringify(id)}: [${arr[0]}]${tail}`);
    } else {
      lines.push(`  ${JSON.stringify(id)}: [${arr.join(",")}]${tail}`);
    }
  });
  lines.push("};");
  lines.push("");
  fs.writeFileSync(path.join(DATA, "dois.js"), lines.join("\n"), "utf8");
  console.log(`已写回 practice/js/data/dois.js（${ids.length} 个条目有映射）`);
})();
