# -*- coding: utf-8 -*-
"""push_full.py —— 把本地仓库当前 HEAD 的完整树一次性同步到远端 main
（用于本地与远端无共同历史、或首次导入的场景）。
远端历史保留：新提交以远端 main 为 parent。
用法：在 hub 仓库根目录运行
"""
import json
import os
import subprocess
import base64
import urllib.request

OWNER = "Neo-icc"
REPO = os.environ.get("GH_REPO", "edu-knowledge-hub")
API = f"https://api.github.com/repos/{OWNER}/{REPO}"


def git(*args):
    return subprocess.check_output(["git", *args]).decode("utf-8", "replace").strip()


def get_token():
    p = subprocess.Popen(["git", "credential", "fill"],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    out, _ = p.communicate(b"protocol=https\nhost=github.com\n\n")
    for line in out.decode().splitlines():
        if line.startswith("password="):
            return line[9:]
    raise SystemExit("未找到已保存的 GitHub 凭据")


def api(path, method="GET", data=None, token=None):
    req = urllib.request.Request(API + path, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, body, timeout=300) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"API {path} 失败 {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")


def main():
    token = get_token()
    local_head = git("rev-parse", "HEAD")
    local_tree = git("rev-parse", "HEAD^{tree}")
    msg = git("show", "-s", "--format=%B", "HEAD")
    author_name = git("show", "-s", "--format=%an", "HEAD")
    author_mail = git("show", "-s", "--format=%ae", "HEAD")
    author_date = git("show", "-s", "--format=%aI", "HEAD")

    ref = api("/git/ref/heads/main", token=token)
    remote_head = ref["object"]["sha"]
    remote_commit = api(f"/git/commits/{remote_head}", token=token)
    remote_tree = remote_commit["tree"]["sha"]
    print(f"远端 main: {remote_head[:8]} | 本地 HEAD: {local_head[:8]}")

    if remote_tree == local_tree:
        print("树已一致，无需推送")
        return

    files = git("ls-tree", "-r", "--long", "HEAD").splitlines()
    print(f"上传 {len(files)} 个文件…")
    entries = []
    for line in files:
        meta, path = line.split("\t", 1)
        parts = meta.split()
        mode, typ, sha, size = parts[0], parts[1], parts[2], parts[3]
        entries.append({"path": path, "mode": mode if mode in ("100644", "100755", "120000") else "100644",
                        "type": "blob", "sha": sha})
        if typ == "blob":
            raw = subprocess.check_output(["git", "cat-file", "blob", sha])
            api("/git/blobs", "POST", {
                "content": base64.b64encode(raw).decode("ascii"),
                "encoding": "base64",
            }, token=token)
    print("文件 blob 上传完成")

    tree = api("/git/trees", "POST", {"tree": entries}, token=token)  # 不带 base_tree = 全新树
    commit = api("/git/commits", "POST", {
        "message": msg,
        "tree": tree["sha"],
        "parents": [remote_head],
        "author": {"name": author_name, "email": author_mail, "date": author_date},
    }, token=token)
    api("/git/refs/heads/main", "PATCH", {"sha": commit["sha"], "force": False}, token=token)
    print(f"完成：远端 main = {commit['sha'][:8]}（本地树 {local_tree[:8]}）")


if __name__ == "__main__":
    main()
