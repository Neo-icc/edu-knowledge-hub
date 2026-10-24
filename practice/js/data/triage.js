/* ============================================================
   快速分诊：把「说不清」的困扰映射到一组情境
   只做路由，不产生新结论；每个 concern 都指向已存在的情境 id
   ============================================================ */
window.ATLAS = window.ATLAS || {};

ATLAS.triage = {
  ages: [
    { id: "0-3", name: "0–3 岁", hint: "婴幼儿" },
    { id: "3-6", name: "3–6 岁", hint: "幼儿园" },
    { id: "6-12", name: "小学", hint: "6–12 岁" },
    { id: "12-15", name: "初中", hint: "12–15 岁" },
    { id: "15-18", name: "高中", hint: "15–18 岁" }
  ],
  concerns: [
    { id: "emotion", name: "情绪与行为", hint: "发脾气、打人、哭闹、撒谎",
      scenarios: ["S03", "S04", "S08", "S09", "S13", "S50", "S57"] },
    { id: "attention", name: "注意力与拖拉", hint: "坐不住、走神、作业慢",
      scenarios: ["S10", "S14", "S15"] },
    { id: "learning", name: "学习与记忆", hint: "记不住、考试、成绩下滑、不愿学",
      scenarios: ["S13", "S14", "S16", "S18", "S21", "S23", "S27", "S36", "S38", "S41", "S43", "S47", "S51"] },
    { id: "language", name: "语言与阅读", hint: "说话晚、认字、跳字漏字",
      scenarios: ["S02", "S11", "S17"] },
    { id: "math", name: "数学与思维", hint: "数概念、应用题、计算",
      scenarios: ["S12", "S16"] },
    { id: "peer", name: "同伴与社交", hint: "抢玩具、被排挤、欺凌、不敢发言",
      scenarios: ["S08", "S19", "S22", "S26", "S39", "S48", "S49", "S56"] },
    { id: "teen", name: "青春期与自主", hint: "顶嘴、关门、手机、早恋、选科、迷茫",
      scenarios: ["S20", "S24", "S25", "S27", "S28", "S29", "S37", "S40", "S42", "S44", "S46"] },
    { id: "sleep", name: "睡眠与屏幕", hint: "夜醒、哄睡、手机、熬夜",
      scenarios: ["S01", "S06", "S20", "S25", "S37", "S44", "S61"] },
    { id: "mood", name: "情绪低落与压力", hint: "持续低落、焦虑、压力、说丧气话",
      scenarios: ["S18", "S30", "S41", "S43", "S45", "S47", "S53", "S54", "S55"] },
    { id: "develop", name: "发育与自理", hint: "分离焦虑、不肯自己做、发育疑虑",
      scenarios: ["S02", "S03", "S07", "S10", "S52", "S58", "S59", "S60"] },
    { id: "myth", name: "担心被误导", hint: "关键期、左右脑、学习风格、报班",
      scenarios: ["S05", "S29", "S31", "S32", "S33", "S34", "S35", "S36"] }
  ],
  durations: [
    { id: "recent", name: "刚出现（不到两周）" },
    { id: "weeks", name: "有几周了" },
    { id: "months", name: "几个月以上" },
    { id: "impact", name: "已影响吃饭、睡觉或上学" }
  ]
};
