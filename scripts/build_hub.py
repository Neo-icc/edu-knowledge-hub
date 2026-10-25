# -*- coding: utf-8 -*-
"""
build_hub.py —— practice 子应用构建期优化（沿用 knowledge-site 的加速思路）

优化项：
  1. 24 个数据 <script> + 内联去重逻辑 → 单个 bundle-data-<hash>.js（terser 格式压缩）
  2. core.js + app.js → 单个 bundle-app-<hash>.js
  3. fonts.css + styles.css → 单个 bundle-<hash>.css（字体路径改到新位置）
  4. 移除完全未被引用的 d3.v7.min.js（280KB，网络图为 canvas 自绘，无 d3 调用）
  5. 全部产物以内容指纹命名 → 可 immutable 长缓存；HTML 引用指纹文件天然失效旧缓存
  6. hub/index.html 注入 prefetch，主页空闲时预取 practice 数据包

幂等：首次运行把原始 practice/index.html 备份为 practice/index.src.html，
之后每次都从 index.src.html 构建。

用法：python scripts/build_hub.py
"""
import hashlib
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "practice")
SRC_HTML = os.path.join(P, "index.src.html")
OUT_HTML = os.path.join(P, "index.html")
NODE = r"C:\Users\Stephen\.workbuddy\binaries\node\versions\22.12.0\node.exe"
MINIFY = r"C:\Users\Stephen\WorkBuddy\2026-10-22-18-31-19\edu-knowledge-site\edu-knowledge-site\scripts\minify.js"
NODE_PATH = r"C:\Users\Stephen\.workbuddy\binaries\node\workspace\node_modules"


def read(p):
    return io.open(p, encoding="utf-8").read()


def write(p, s):
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)


def sha8(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()[:8]


def minify_js(src_text, tag):
    """terser 格式压缩（语义零改动）；失败则原样返回并告警"""
    tmp_in = os.path.join(P, f"_tmp_{tag}.js")
    tmp_out = os.path.join(P, f"_tmp_{tag}.min.js")
    write(tmp_in, src_text)
    env = dict(os.environ, NODE_PATH=NODE_PATH)
    r = subprocess.run([NODE, MINIFY, tmp_in, tmp_out], capture_output=True, text=True, env=env)
    if r.returncode != 0 or not os.path.exists(tmp_out):
        print(f"  [warn] terser 失败({tag})，使用未压缩版本: {r.stderr[:120]}")
        out = src_text
    else:
        out = read(tmp_out)
    for f in (tmp_in, tmp_out):
        if os.path.exists(f):
            os.remove(f)
    return out


def strip_css_comments(css):
    """删除 CSS 注释（跳过字符串内的 /* ），并折叠多余空白"""
    out = []
    i, n = 0, len(css)
    quote = None
    while i < n:
        ch = css[i]
        if quote:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(css[i + 1]); i += 2; continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in "\"'":
            quote = ch; out.append(ch); i += 1; continue
        if ch == "/" and i + 1 < n and css[i + 1] == "*":
            j = css.find("*/", i + 2)
            i = (j + 2) if j >= 0 else n
            continue
        out.append(ch); i += 1
    css = "".join(out)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{};:,>])\s*", r"\1", css)
    return css.strip()


def main():
    if not os.path.exists(SRC_HTML):
        write(SRC_HTML, read(OUT_HTML))
        print("已备份原始 HTML → practice/index.src.html")
    html = read(SRC_HTML)

    # ---------- 1. 收集脚本 ----------
    srcs = re.findall(r'<script src="(js/[^"]+?)"', html)
    data_srcs = [s for s in srcs if s.startswith("js/data/")]
    core_srcs = [s for s in srcs if re.match(r"js/(core|app)\.js", s)]
    vendor_srcs = [s for s in srcs if "vendor" in s]
    if not data_srcs or not core_srcs:
        sys.exit("未找到预期的脚本结构，已中止（检查 practice/index.src.html）")

    # 内联去重脚本（位于数据之后、core 之前）
    m = re.search(r"<script>\s*// 数据规范化.*?</script>", html, re.S)
    inline_js = ""
    if m:
        inline_js = re.sub(r"^<script>|</script>$", "", m.group(0).strip(), flags=re.S)

    print(f"数据文件 {len(data_srcs)} 个 · 应用脚本 {len(core_srcs)} 个 · vendor {len(vendor_srcs)} 个")

    # ---------- 2. 合并 data ----------
    parts = []
    for s in data_srcs:
        path = os.path.join(P, s.split("?")[0])
        parts.append(f"/* {os.path.basename(path)} */\n" + read(path))
    if inline_js:
        parts.append("/* 数据规范化（原内联脚本） */\n" + inline_js)
    data_raw = "\n;\n".join(parts)
    data_min = minify_js(data_raw, "data")
    data_name = f"bundle-data-{sha8(data_min)}.js"
    write(os.path.join(P, data_name), data_min)

    # ---------- 3. 合并 app ----------
    app_parts = []
    for s in core_srcs:
        path = os.path.join(P, s.split("?")[0])
        app_parts.append(f"/* {os.path.basename(path)} */\n" + read(path))
    app_min = minify_js("\n;\n".join(app_parts), "app")
    app_name = f"bundle-app-{sha8(app_min)}.js"
    write(os.path.join(P, app_name), app_min)

    # ---------- 4. 合并 CSS ----------
    css = read(os.path.join(P, "css", "fonts.css")) + "\n" + read(os.path.join(P, "css", "styles.css"))
    # fonts.css 位于 css/ 下，字体用 ../js/vendor/...；合并后位于 practice/ 根，需要去掉一层 ../
    css = css.replace("../js/vendor/fonts/", "js/vendor/fonts/")
    css_min = strip_css_comments(css)
    css_name = f"bundle-{sha8(css_min)}.css"
    write(os.path.join(P, css_name), css_min)

    # ---------- 5. 重写 HTML ----------
    new = html
    for s in data_srcs + core_srcs + [v for v in vendor_srcs if "d3" in v]:
        pat = r"\s*<script src=\"" + re.escape(s) + r"\"></script>"
        new = re.sub(pat, "", new)
    if m:
        new = re.sub(r"\s*<script>\s*// 数据规范化.*?</script>", "", new, flags=re.S)
    new = re.sub(r'\s*<link rel="stylesheet" href="css/(fonts|styles)\.css[^"]*"\s*/?>', "", new)

    # 注入 bundle 引用
    new = new.replace("</head>",
        f'  <link rel="stylesheet" href="{css_name}" />\n</head>', 1)
    new = new.replace("</body>",
        f'  <script src="{data_name}" defer></script>\n'
        f'  <script src="{app_name}" defer></script>\n</body>', 1)
    write(OUT_HTML, new)

    # ---------- 6. hub 主页 prefetch ----------
    hub_index = os.path.join(ROOT, "index.html")
    hub = read(hub_index)
    hub = re.sub(r'\s*<link rel="prefetch" href="practice/bundle-[^"]*"[^>]*>', "", hub)
    hub = hub.replace("</head>",
        f'  <link rel="prefetch" href="practice/{data_name}" as="script" />\n'
        f'  <link rel="prefetch" href="practice/{app_name}" as="script" />\n'
        f'  <link rel="prefetch" href="practice/{css_name}" as="style" />\n</head>', 1)
    write(hub_index, hub)

    # ---------- 7. 报告 ----------
    def size(p):
        return os.path.getsize(p)

    before_req = len(data_srcs) + len(core_srcs) + len(vendor_srcs) + 2
    after_req = 3  # data + app + css
    before_bytes = sum(size(os.path.join(P, s.split("?")[0])) for s in data_srcs + core_srcs)
    before_bytes += sum(size(os.path.join(P, s.split("?")[0])) for s in vendor_srcs)
    before_bytes += size(os.path.join(P, "css/fonts.css")) + size(os.path.join(P, "css/styles.css"))
    after_bytes = size(os.path.join(P, data_name)) + size(os.path.join(P, app_name)) + size(os.path.join(P, css_name))
    print("\n=== 构建完成 ===")
    print(f"  请求数: {before_req} → {after_req}")
    print(f"  原始体积: {before_bytes/1024:.0f} KB → 合并压缩后: {after_bytes/1024:.0f} KB "
          f"（另加字体按需 {sum(size(os.path.join(P,'js/vendor/fonts',f)) for f in os.listdir(os.path.join(P,'js/vendor/fonts')))/1024:.0f} KB）")
    print(f"  产物: {data_name} · {app_name} · {css_name}")
    print("  已移除无引用的 d3.v7.min.js（280 KB）")


if __name__ == "__main__":
    main()
