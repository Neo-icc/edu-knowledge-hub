import re, subprocess, sys

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://epck.space"
PAGES = ["/", "/practice/", "/research/"]

def fetch(url):
    r = subprocess.run(["curl", "-s", "--max-time", "30", "-w", "\n__CODE__%{http_code}", url],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    body = r.stdout
    m = re.search(r"\n__CODE__(\d+)$", body)
    code = m.group(1) if m else "000"
    if m:
        body = body[:m.start()]
    return code, body

def head(url):
    r = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code} %{size_download}",
                        "--max-time", "30", url], capture_output=True, text=True)
    return r.stdout.strip()

total, bad = 0, []
for p in PAGES:
    code, html = fetch(BASE + p)
    print(f"\n=== {p}  HTTP {code}  ({len(html)} 字节) ===")
    if code != "200":
        bad.append((p, "页面 HTTP " + code))
        continue
    # 标题
    t = re.search(r"<title>([^<]*)</title>", html)
    print("  标题:", t.group(1) if t else "(无)")
    # 收集本地资源引用
    refs = set()
    for m in re.finditer(r'(?:src|href)="([^"#?]+)(?:\?[^"]*)?"', html):
        u = m.group(1)
        if u.startswith(("http", "//", "mailto:", "data:", "javascript:")):
            continue
        if u.endswith((".js", ".css", ".woff2", ".png", ".svg", ".ico", ".jpg")):
            refs.add(u)
    # 相对路径转绝对
    results = []
    for u in sorted(refs):
        if u.startswith("/"):
            full = BASE + u
        else:
            full = BASE + p.rstrip("/") + "/" + u if p != "/" else BASE + "/" + u
        st = head(full)
        total += 1
        ok = st.startswith("200")
        results.append((u, st, ok))
        if not ok:
            bad.append((p, u + " -> " + st))
    for u, st, ok in results:
        print(f"  {'OK ' if ok else 'BAD'} {st:>14}  {u}")

print(f"\n===== 汇总：检查 {total} 个资源引用，异常 {len(bad)} 个 =====")
for p, why in bad:
    print("  !", p, why)
print("PASS" if not bad else "FAIL")
