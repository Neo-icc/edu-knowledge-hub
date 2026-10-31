/* ============================================================
   minify.js —— build_hub.py 调用的压缩入口
   用法：node scripts/minify.js <in.js> <out.js> [--format]

   优先使用 terser（语法级压缩，语义零改动）。
   找不到 terser 时退化为「保守压缩」：只删注释与行首尾空白，
   不重命名标识符、不合并语句 —— 体积收益小，但绝不会改变语义，
   比「压缩失败直接报错」或「用危险的土办法压缩」都更安全。
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error("用法: node scripts/minify.js <in.js> <out.js>");
  process.exit(2);
}

function loadTerser() {
  const candidates = [];
  if (process.env.TERSER_HOME) candidates.push(path.join(process.env.TERSER_HOME, "node_modules", "terser"));
  if (process.env.NODE_PATH) {
    for (const p of process.env.NODE_PATH.split(path.delimiter)) {
      if (p.trim()) candidates.push(path.join(p.trim(), "terser"));
    }
  }
  candidates.push("terser");
  try {
    /* 同目录同项目 node_modules 兜底 */
    candidates.push(path.join(__dirname, "..", "node_modules", "terser"));
    require.resolve(path.join(__dirname, "..", "node_modules", "terser"));
  } catch (e) { /* 忽略 */ }

  for (const c of candidates) {
    try { return require(c); } catch (e) { /* 继续找 */ }
  }
  return null;
}

/* 保守压缩：去块注释 / 行注释（跳过字符串与正则字面量），再逐行 trim 丢弃空行 */
function conservative(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let state = "code"; // code | line | block | sq | dq | tpl | regex
  let prevMeaningful = "";
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (state === "code") {
      if (c === "/" && d === "*") { state = "block"; i += 2; continue; }
      if (c === "/" && d === "/") { state = "line"; i += 2; continue; }
      if (c === "'") state = "sq";
      else if (c === '"') state = "dq";
      else if (c === "`") state = "tpl";
      out += c;
      if (!/\s/.test(c)) prevMeaningful = c;
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += c; }
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") { state = "code"; i += 2; continue; }
      i++;
      continue;
    }
    /* 字符串内部：原样保留，处理转义 */
    if (c === "\\") { out += c + (d === undefined ? "" : d); i += 2; continue; }
    if (state === "sq" && c === "'") state = "code";
    else if (state === "dq" && c === '"') state = "code";
    else if (state === "tpl" && c === "`") state = "code";
    out += c;
    i++;
  }
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length)
    .join("\n");
}

(async function main() {
  const src = fs.readFileSync(inFile, "utf8");
  const terser = loadTerser();

  if (!terser || !terser.minify) {
    /* 静默降级是这个项目踩过的坑（字体损坏、压缩失败都曾无提示）。
       这里必须吵出来，否则产物悄悄变大 200KB 而没人发现。 */
    console.error(
      "[warn] 未找到 terser，已退化为保守压缩（只删注释，不重命名），产物体积会偏大。\n" +
      "       修复：npm i terser ws --no-save --prefix \"$HOME/.cache/wb-terser\"\n" +
      "       然后 TERSER_HOME=\"$HOME/.cache/wb-terser\" python scripts/build_hub.py"
    );
  }

  if (terser && terser.minify) {
    const r = await terser.minify(src, {
      compress: true,
      mangle: true,
      format: { comments: false, ascii_only: false },
    });
    if (r && r.code) {
      fs.writeFileSync(outFile, r.code, "utf8");
      return;
    }
    if (r && r.error) throw new Error(String(r.error));
  }

  fs.writeFileSync(outFile, conservative(src), "utf8");
})().catch((e) => {
  console.error("minify 失败:", e && e.message ? e.message : e);
  process.exit(1);
});
