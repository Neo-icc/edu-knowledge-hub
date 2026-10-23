# 教育与心智 · 知识图谱（edu-knowledge-hub）

同一入口，三种身份的教育、心理与儿童发展知识库。老师和家长走「情境优先」拿到可执行的做法；研究者与学者走「研究索引」做深度检索与导航。

**在线访问**：https://neo-icc.github.io/edu-knowledge-hub/

## 三身份，两个内容源

| 身份 | 进入 | 内容源 | 你会得到 |
|---|---|---|---|
| 家长 | `practice/` | education-mind-atlas | 按年龄分诊、在家可以试、可以对孩子说的话、就医边界、A4 一页纸 |
| 老师 | `practice/` | education-mind-atlas | 课堂情境、5 分钟活动脚本、转介建议、机制级关联与术语卡 |
| 研究者 / 学者 | `research/` | edu-psych-child-knowledge | 五大领域 454 条深度条目：定义、论断、学界共识与学术分歧 |

两个内容源各自独立、数据自洽，通过同一门户入口与顶栏身份切换连接，不互相污染。

## 目录结构

```
index.html                 门户：落地页 + 顶栏身份切换 + iframe 承载
practice/                  情境优先（家长 / 老师）
  index.html               教育图谱入口
  css/ js/                 图谱引擎、数据与样式
research/                  研究索引（研究者）
  index.html               知识全景导航（单文件应用）
  data-entries.js          454 条标准条目 + 学者简介 + 可视化
.nojekyll                  让 Pages 直接服务静态文件
```

## 本地运行

无需构建。任意静态服务器：

```bash
python -m http.server 8899
```

然后访问 http://localhost:8899/。

> 直接双击 `index.html` 也能打开，但 iframe 加载子应用时建议用本地服务器，避免 `file://` 策略限制。

## 部署

托管在 GitHub Pages，来源为 `main` 分支根目录。推送后自动重建：

```bash
git add .
git commit -m "update hub"
git push
```
