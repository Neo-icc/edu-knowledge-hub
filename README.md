# 教育与心智 · 知识图谱（edu-knowledge-hub）

一个入口，两种用法：家长与老师走「情境优先」，拿到在家／课堂上可以试的做法；
教育研究者走「研究索引」，检索、引用、溯源。

**在线访问**：https://www.epck.space/

---

## 两个入口，两套内容

| 入口 | 路径 | 内容源 | 你会得到 |
|---|---|---|---|
| 家长 · 老师 | `practice/` | education-mind-atlas | 按困扰＋年龄＋身份分诊的 64 个场景，含「可以试 / 先别做 / 可以这样说 / 何时找专业帮助 / 背后的机制」，可导出 A4 一页纸 |
| 教育研究者 | `research/` | edu-psych-child-knowledge | 五大领域 454 条深度条目：定义、论断、学界共识与学术分歧，支持按作者／年份／DOI／编号检索与 BibTeX/RIS 引用 |

两套数据各自独立、互不污染，通过门户顶栏切换。门户本身只做落地页与 iframe 承载。

## 项目现状

| 项 | 数量 |
|---|---|
| 理论条目 | 469（5 领域 / 33 分支） |
| 机制关联 | 804（原始 876，同配对同类型去重 72） |
| 场景 / 情境 | 64（全部纳入分诊） |
| 术语卡 | 2036 |
| 证据条目 | 1261（可定位率 97.8%：DOI 739 + 有明确出处 494） |
| 人物 | 381 |

数据现状与体检结论见 **[reports/AUDIT-2026-10.md](reports/AUDIT-2026-10.md)**；
架构、演进史与每一轮改动的原因见 **[PROJECT.md](PROJECT.md)**。

## 目录结构

```
index.html                 门户：落地页 + 顶栏切换 + iframe（构建时注入 prefetch 指纹）
CNAME / _headers / _redirects / .nojekyll   托管配置（自定义域、缓存、裸域跳转）

practice/                  家长·老师子应用
  index.src.html           构建源（脚本源文件列表）
  index.html               构建产物（引用带指纹的 bundle，勿手改）
  bundle-data-<hash>.js    全部数据打成一个包
  bundle-app-<hash>.js     core.js + app.js + qr.js
  bundle-<hash>.css        fonts.css + styles.css
  css/ js/                 源文件（data/ 27 个数据文件、core.js、app.js、vendor 字体）

research/                  教育研究子应用（单文件应用 + 懒加载数据块）
  index.html
  data-entries-<hash>.js   454 条条目
  data-thinkers-<hash>.js  学者简介与配图

scripts/                   工具（见下）
reports/                   体检报告与人工判定记录
screenshots/               站点截图（未被页面引用，仅备查）
```

## 构建

`practice/` 不是直接改 `index.html` 的——数据与脚本要先打包。

```bash
# 需要 terser；缺失时 minify.js 会显式告警并退化为保守压缩（体积 +200KB）
npm i terser@5 ws --no-save --prefix "$HOME/.cache/wb-terser"
TERSER_HOME="$HOME/.cache/wb-terser" python scripts/build_hub.py
```

构建会：合并 27 个数据文件 → 压缩 → 按内容指纹命名 → 回写 `practice/index.html`
与门户的 prefetch 指纹。**改完数据必须重跑，否则门户加载的仍是旧包。**

## 脚本

| 脚本 | 用途 |
|---|---|
| `build_hub.py` | 构建 practice 子应用（打包 / 指纹 / 注入 prefetch） |
| `minify.js` | 构建依赖的压缩入口；terser 缺失时显式告警，不静默降级 |
| `audit-all.js` | 全域体检：领域/分支/证据分级/DOI/孤立节点/完整性。**改数据后必跑** |
| `backfill-doi.js` | 英文式证据的 DOI 核验流水线（题名相似度 + 年份窗口） |
| `backfill-doi-zh.js` | 中文叙述式证据专用：候选生成 → 人工核对 → 按判定清单写入 |
| `verify-dois.js` | 把全部 DOI 拉回 Crossref 复核存在性/类型/年份 |
| `hub-check.js` | UI 回归（55 项断言：门户、顶栏、侧栏一致性、宽屏居中、移动端） |
| `smoke-live.js` | 上线后冒烟：打开生产站点断言渲染结果与控制台错误 |
| `probe-fold.js` | 折叠态侧栏实测（点击驱动，不依赖改 localStorage） |
| `verify-fonts.js` | 字体解码回归（项目曾因字体文件损坏全站静默回退系统字体） |
| `check-cdn.py` | 扫描三页引用的全部资源是否 200，专门兜 CSS/图片 404（控制台不报错） |

验收脚本依赖 Edge 与 `ws`：

```bash
NODE_PATH="$HOME/.cache/wb-terser/node_modules" node scripts/hub-check.js
NODE_PATH="$HOME/.cache/wb-terser/node_modules" node scripts/smoke-live.js
```

## 本地预览

```bash
python -m http.server 8899 --bind 127.0.0.1
# 打开 http://127.0.0.1:8899/
```

需要走本地服务器（不要直接双击 `index.html`）：门户用 iframe 承载子应用，
`file://` 策略会拦截。

## 部署

GitHub Pages，源为 `main` 分支根目录；主域 `www.epck.space` 经腾讯云 CDN 回源，
裸域 `epck.space` 由 `_redirects` 301 到主域。

```bash
git add -A && git commit -m "..." && git push origin main
gh api repos/Neo-icc/edu-knowledge-hub/pages/builds/latest   # 查构建状态
```

推送后约 30–60 秒生效，然后跑一次 `smoke-live.js`。

## 三条必须知道的约束

1. **不要手写版本号**。产物按内容指纹命名，门户从 prefetch 指纹自动派生 `v=` 参数给 iframe。
   手工维护 `?v=47` 这类写法已经废弃，漏改就会让用户看到旧资源。
2. **旧 bundle 留一版再删**。HTML 的 `Cache-Control` 是 `max-age=600`，
   若删包与换 HTML 在同一次提交，最坏有 10 分钟窗口——拿着旧 HTML 的用户会请求到已删除的文件而白屏。
3. **证据可定位率 ≠ DOI 覆盖率**。一手经典（《理想国》《大教学论》）没有 DOI，
   用 DOI 率衡量会误判。口径见 reports/AUDIT-2026-10.md 第 2.1 节。

## 许可与来源

本项目由 Stephen 校长公益整理，所有内容免费开放。
