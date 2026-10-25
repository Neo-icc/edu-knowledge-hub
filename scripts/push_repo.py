# -*- coding: utf-8 -*-
"""github_api_push.py —— 通过 api.github.com 的 Git 数据接口推送本地提交。

用途：github.com:443 不可达时（本机网络波动），用 api.github.com 这条一直可用的
通道完成推送。以【树对比】判定同步状态，对提交 sha 的差异天然免疫：
  - 远端 main 的树 == 本地 HEAD 的树 → 已同步，只刷新本地 origin/main 引用
  - 否则从本地历史往回走，找到第一个"树与远端树一致"的祖先，复制其后的提交
    （blob → tree → commit → update ref），与 git push 等价。

用法：在 .deploy-site 仓库内运行 python github_api_push.py
"""
import json
import subprocess
import base64
import urllib.request
import urllib.error

import os
OWNER = "Neo-icc"
REPO = os.environ.get("GH_REPO", "edu-knowledge-hub")
API = f"https://api.github.com/repos/{OWNER}/{REPO}"


def git(*args):
    return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL).decode("utf-8", "replace").strip()


def get_token():
    p = subprocess.Popen(["git", "credential", "fill"],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL)
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
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, body, timeout=180) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise SystemExit(f"API {method} {path} 失败 {e.code}: {detail[:300]}")


def tree_of(sha):
    return git("rev-parse", f"{sha}^{{tree}}")


def main():
    token = get_token()
    if token[:3] not in ("ghp", "gho", "ghs"):
        raise SystemExit(f"凭据不是 token（前缀 {token[:3]}），中止")

    head = api("/git/refs/heads/main", token=token)
    remote_sha = head["object"]["sha"]
    remote_commit = api(f"/git/commits/{remote_sha}")  # 公开读，不需要写权限
    remote_tree = remote_commit["tree"]["sha"]
    print("远端 main:", remote_sha[:8], "| 树:", remote_tree[:8])

    local_head = git("rev-parse", "HEAD")
    local_tree = tree_of(local_head)
    print("本地 HEAD:", local_head[:8], "| 树:", local_tree[:8])

    if local_tree == remote_tree:
        print("树一致：内容已同步（提交 sha 差异忽略）")
        # 远端提交对象在本地不存在（API 创建的 sha 与本地不同），
        # 删除过时的 origin/main 引用，避免 status 永远显示 ahead
        subprocess.run(["git", "update-ref", "-d", "refs/remotes/origin/main"],
                       check=False, stderr=subprocess.DEVNULL)
        return

    # 从本地历史往回找树一致的祖先
    commits_to_push = []
    cur = local_head
    squash = False
    while True:
        if tree_of(cur) == remote_tree:
            break
        commits_to_push.append(cur)
        parents = git("rev-parse", f"{cur}^@").split()
        if not parents:
            squash = True
            break
        cur = parents[0]
    commits_to_push.reverse()

    if squash:
        # 历史分叉（如 git commit --amend 重写了提交）：把本地 HEAD 的整棵树
        # 作为单个提交直接盖到远端 head 之上，避免无法定位共同祖先。
        print("历史分叉，改为整树合并：以本地 HEAD 内容覆盖远端")
        entries = []
        for line in git("ls-tree", local_head).splitlines():
            mode, typ, sha, path = line.split(None, 3)
            raw = subprocess.check_output(["git", "cat-file", "blob", sha])
            api("/git/blobs", "POST", {
                "content": base64.b64encode(raw).decode("ascii"),
                "encoding": "base64",
            }, token=token)
            entries.append({"path": path, "mode": mode, "type": typ, "sha": sha})
        tree = api("/git/trees", "POST", {"tree": entries}, token=token)
        msg = git("show", "-s", "--format=%B", local_head)
        author_name = git("show", "-s", "--format=%an", local_head)
        author_mail = git("show", "-s", "--format=%ae", local_head)
        author_date = git("show", "-s", "--format=%aI", local_head)
        committer_name = git("show", "-s", "--format=%cn", local_head)
        committer_mail = git("show", "-s", "--format=%ce", local_head)
        committer_date = git("show", "-s", "--format=%cI", local_head)
        new_commit = api("/git/commits", "POST", {
            "message": msg,
            "tree": tree["sha"],
            "parents": [remote_sha],
            "author": {"name": author_name, "email": author_mail, "date": author_date},
            "committer": {"name": committer_name, "email": committer_mail, "date": committer_date},
        }, token=token)
        api("/git/refs/heads/main", "PATCH", {"sha": new_commit["sha"], "force": False}, token=token)
        subprocess.run(["git", "update-ref", "-d", "refs/remotes/origin/main"],
                       check=False, stderr=subprocess.DEVNULL)
        print(f"    → 远端新提交 {new_commit['sha'][:8]}（{len(entries)} 个文件）")
        print("完成：远端 main =", new_commit["sha"][:8])
        return

    print(f"需要复刻 {len(commits_to_push)} 个提交（自本地 {cur[:8]} 之后，其树与远端一致）")

    # 基线：直接用远端 head 作为 parent、远端树作为 base_tree。
    # 注意本地"匹配祖先"可能是本地独有的 sha（GitHub 序列化差异导致 sha 不同），
    # 所以不能去远端取它的树，而应沿用远端自己的 head/tree。
    remote_cur = remote_sha
    base_tree = remote_tree

    for sha in commits_to_push:
        msg = git("show", "-s", "--format=%B", sha)
        author_name = git("show", "-s", "--format=%an", sha)
        author_mail = git("show", "-s", "--format=%ae", sha)
        author_date = git("show", "-s", "--format=%aI", sha)
        committer_name = git("show", "-s", "--format=%cn", sha)
        committer_mail = git("show", "-s", "--format=%ce", sha)
        committer_date = git("show", "-s", "--format=%cI", sha)

        entries = []
        changed = git("diff-tree", "--no-commit-id", "--name-status", "-r", sha).splitlines()
        for line in changed:
            if not line:
                continue
            status, path = line.split("\t", 1)
            if status == "D":
                # 删除文件：tree 条目 sha=null 表示从基线树中移除
                entries.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
                continue
            blob_sha = git("rev-parse", f"{sha}:{path}")
            raw = subprocess.check_output(["git", "cat-file", "blob", blob_sha])
            api("/git/blobs", "POST", {
                "content": base64.b64encode(raw).decode("ascii"),
                "encoding": "base64",
            }, token=token)
            entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob_sha})
        print(f"  提交 {sha[:8]}: {msg.splitlines()[0][:50]}（{len(entries)} 个文件）")

        tree = api("/git/trees", "POST", {"base_tree": base_tree, "tree": entries}, token=token)
        new_commit = api("/git/commits", "POST", {
            "message": msg,
            "tree": tree["sha"],
            "parents": [remote_cur],
            "author": {"name": author_name, "email": author_mail, "date": author_date},
            "committer": {"name": committer_name, "email": committer_mail, "date": committer_date},
        }, token=token)
        api("/git/refs/heads/main", "PATCH", {"sha": new_commit["sha"], "force": False}, token=token)
        remote_cur = new_commit["sha"]
        base_tree = tree["sha"]
        print(f"    → 远端新提交 {remote_cur[:8]}")

    subprocess.run(["git", "update-ref", "-d", "refs/remotes/origin/main"],
                   check=False, stderr=subprocess.DEVNULL)
    print("完成：远端 main =", remote_cur[:8])


if __name__ == "__main__":
    main()
