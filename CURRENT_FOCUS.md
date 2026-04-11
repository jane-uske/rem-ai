# CURRENT_FOCUS.md

## 一句话

Memory V1 / 关系层第一阶段 **已完成** —— Rem 现在具备了完整的跨会话关系记忆连续性。

## 当前最高优先级

关系层第二阶段：主动记忆巩固与语义分层（记忆 V2）

## 为什么现在做这个

- 关系骨架已经闭环：per-user 关系状态持久化 + episode 分层召回 + proactive 分线索冷却 + 关系风格槽位绑定全部完成
- 当前最大缺口： episodic记忆还只停留在关键词匹配，没有做语义嵌入聚类；主动开口还只有规则，没有做基于关系状态的主动决策
- 如果现在先做前端展示优化，容易得到一个好看但“记不住你”的产品，无法达成“记得我们的关系”这个核心差异化

## 当前阶段交付目标

- 语义 Episode 聚类：用 embedding 将 shared moments 自动聚合成更自然的长周期话题线
- 主动对话触发：基于关系状态和未完结 episode 主动开口的决策策略
- 增量更新优化：只对新增/修改的 episode 做语义计算，不重复全量计算
- 保留无向量回退：所有新功能在没有 pgvector/pg 环境下仍能优雅降级到关键词模式

## 当前非目标

- 不重做已有的关系状态持久化层
- 不把全量语义计算塞进每轮请求路径（保持离线增量）
- 不先做端到端情绪大改造（T-040 仍在等待列表）
- 不先做前端口型同步（T-032 仍在等待列表）

## 当前已确认现状（记忆 V1 已完成）

- ✅ per-user relationship state 持久化与恢复链路已接通并文档化
- ✅ 跨重连关系连续性完整恢复
- ✅ prompt 注入：relationship summary / topic continuity / mood trajectory / proactive hooks 全部到位
- ✅ slow brain 非阻塞写回持久层已实现
- ✅ interrupted partial 污染保护规则已明确并强制执行
- ✅ Episode recall layer 已分离 `core`/`active` 两层
- ✅ Proactive 已按线索分 ledger 独立冷却周期
- ✅ Persona prompt 已有稳定的关系阶段/回复合同槽位
- ✅ Realtime continuity policy v2 已与 prediction gate 联动

## 执行规则

- 当前主线程内的代码任务做完后，必须回写对应任务文档状态
- 至少更新 `TASKS.md` 中对应的任务状态
- 如果本次改动改变了当前主线程判断或交付边界，也要同步更新本文件
- 不要只改代码不改任务文档，否则下一个 agent 很容易误判当前进度
