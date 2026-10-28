import pathlib, re

log = []

# ============ practice: app.js 移动按钮位置 ============
pa = pathlib.Path(r"C:/Users/Stephen/WorkBuddy/2026-10-22-18-31-19/edu-knowledge-hub/practice/js/app.js")
s = pa.read_text(encoding="utf-8")
old = '''    <button class="fold-float" id="fold-float" aria-label="展开侧栏" title="展开侧栏">☰<span>展开侧栏</span></button>
    <div class="app-shell'''
new = '''    <div class="app-shell'''
assert s.count(old) == 1, "practice float anchor 1"
s = s.replace(old, new)
old2 = '''          <button class="icon-btn mobile-only" id="nav-btn" aria-label="打开导航">☰</button>'''
new2 = old2 + '''
          <button class="fold-float" id="fold-float" aria-label="展开侧栏" title="展开侧栏">☰<span>展开侧栏</span></button>'''
assert s.count(old2) == 1, "practice float anchor 2"
s = s.replace(old2, new2)
pa.write_text(s, encoding="utf-8")
log.append("practice/app.js: 展开按钮移入 topbar")

# ============ practice: styles.css 悬浮改流内 ============
pc = pathlib.Path(r"C:/Users/Stephen/WorkBuddy/2026-10-22-18-31-19/edu-knowledge-hub/practice/css/styles.css")
c = pc.read_text(encoding="utf-8")
old3 = '''  body.nav-fold .fold-float {
    position: fixed; left: 14px; top: 14px; z-index: 130;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 12px; border: 1px solid var(--rule-2); border-radius: 999px;
    background: var(--paper); color: var(--ink-2); cursor: pointer;
    box-shadow: var(--shadow-3); font-size: 0.85rem;
  }'''
new3 = '''  body.nav-fold .fold-float {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 12px; border: 1px solid var(--rule-2); border-radius: 999px;
    background: transparent; color: var(--ink-2); cursor: pointer;
    font-size: 0.85rem; flex: 0 0 auto;
  }'''
assert c.count(old3) == 1, "practice css anchor"
c = c.replace(old3, new3)
pc.write_text(c, encoding="utf-8")
log.append("practice/styles.css: 悬浮胶囊 -> 流内按钮")

# ============ research / 旧站：HTML 移位 + CSS ============
def patch_site(p, label):
    t = p.read_text(encoding="utf-8")
    # 1) 移除 app 尾部的 fold-float
    m = re.search(r'</main>\s*\n?\s*<button class="fold-float"[^>]*>.*?</button>', t, re.S)
    assert m, label + " float 尾部未找到"
    t = t[:m.start()] + "</main>" + t[m.end():]
    # 2) 插入 topbar（menubtn 之后）
    anchor = '<button id="menubtn" title="折叠侧栏"><span aria-hidden="true">☰</span><span class="mf-label">收起目录</span></button>'
    assert t.count(anchor) == 1, label + " menubtn 未找到"
    insert = anchor + '\n      <button class="fold-float" id="foldfloat" type="button" aria-label="展开侧栏" title="展开侧栏">☰<span>展开侧栏</span></button>'
    t = t.replace(anchor, insert)
    # 3) CSS：悬浮改流内
    old_css = '''  body.nav-fold .fold-float{position:fixed;left:14px;top:14px;z-index:130;
    display:inline-flex;align-items:center;gap:6px;padding:8px 12px;
    border:1px solid var(--line);border-radius:999px;background:var(--bg);
    color:var(--fg2);cursor:pointer;font-size:13.6px;line-height:1.7;
    box-shadow:0 10px 28px rgba(0,0,0,.18)}'''
    new_css = '''  body.nav-fold .fold-float{
    display:inline-flex;align-items:center;gap:6px;padding:4px 10px;
    border:1px solid var(--line);border-radius:999px;background:transparent;
    color:var(--fg2);cursor:pointer;font-size:13.6px;line-height:1.7;flex:0 0 auto}'''
    assert t.count(old_css) == 1, label + " css 未找到"
    t = t.replace(old_css, new_css)
    p.write_text(t, encoding="utf-8")
    log.append(label + ": 按钮入 topbar + 样式流内化")

patch_site(pathlib.Path(r"C:/Users/Stephen/WorkBuddy/2026-10-22-18-31-19/edu-knowledge-hub/research/index.html"), "hub research")
patch_site(pathlib.Path(r"C:/Users/Stephen/WorkBuddy/2026-10-22-18-31-19/edu-knowledge-site/edu-knowledge-site/template.html"), "旧站 template")

print("\n".join(log))
