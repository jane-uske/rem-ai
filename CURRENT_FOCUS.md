# CURRENT_FOCUS.md

## 一句话

Rem 现在已经接近一个可展示的实时语音角色 demo，但离“真正会被感到有关系感的虚拟伴侣”还远。

## 当前唯一最高优先级

关系层第一阶段。

当前目标不是继续把语音链路磨得更丝滑一点，而是先把“她记得我们”做成。

## 为什么现在先做这个

- 当前骨架已经有了：实时语音、快慢脑、memory、avatar、interrupt 语义
- 当前最大缺口不是“不能聊”，而是“关系连续性还没形成闭环”
- 如果继续只做 VAD / TTS / playback 局部优化，很容易得到一个更顺滑的语音 bot，而不是更像 Rem 的陪伴系统

## 当前已确认现状

- relationship state 写回已存在
- `hydratePersistentRelationshipState(...)` 入口已存在，但还没接到 session init 主链路
- retrieval 仍然主要是 `getAll()`
- pgvector 相似召回目前只在存储层

## 当前阶段交付

- 用户级 relationship state 恢复
- 跨重连恢复
- prompt 注入 relationship summary / topic continuity / mood trajectory / proactive hooks
- slow brain 非阻塞写回持久层
- interrupted partial 不污染正式状态

## 当前非目标

- 不做大重写
- 不先做完整主动 agent
- 不先扩 avatar 表现层
- 不把慢脑重逻辑塞进 fast path

## 执行规则

- 当前主线程内的代码任务做完后，必须回写对应任务文档状态
- 至少更新 `TASKS.md` 中对应的 `R-*` 或相关任务状态
- 如果本次改动改变了当前主线程判断或交付边界，也要同步更新本文件
- 不要只改代码不改任务文档，否则下一个 agent 很容易误判当前进度

## 接下来的子任务

### R-001 文档入口统一

- 目标：让 agent 一进仓库就知道当前主线程
- 输入/输出：更新 `AGENTS.md`、新增本文件、更新 `TASKS.md`
- 不做什么：不改实现逻辑
- 验收标准：只看 `AGENTS.md` 就能知道当前优先级，只看 `TASKS.md` 就能选一个任务开工

### R-002 关系状态恢复链路文档化

- 目标：把 relationship state 的 restore 链路说清楚
- 输入/输出：明确 session init、hydrate 入口、失败降级
- 不做什么：不在本任务里实现恢复代码
- 验收标准：读文档的人能说清 restore 在哪里接、失败后怎么退化

### R-003 prompt 消费链路文档化

- 目标：说清 relationship state 如何进入 prompt
- 输入/输出：定义 `synthesizeContext()`、`buildConversationStrategyHints()`、priority context 的职责
- 不做什么：不重写 prompt builder
- 验收标准：agent 能区分“关系摘要”和“本轮说话策略”分别从哪里来

### R-004 记忆召回升级任务定义

- 目标：把 retrieval 从 `getAll()` 升级为相关召回
- 输入/输出：定义 topic / mood / relationship 优先级，分离 system memory key
- 不做什么：不在本任务里落 embedding 流水线大改造
- 验收标准：任务描述能指导后续实现相关召回且保留无向量回退

### R-005 中断污染保护任务定义

- 目标：继续守住 formal state 不被 interrupted partial 污染
- 输入/输出：明确 history / slow brain / relationship state 的保护规则
- 不做什么：不改现有 interrupt 语义
- 验收标准：文档能明确哪些状态允许 carry-forward，哪些不能写正式持久层

### R-006 fast brain 行为层准备任务定义

- 目标：为 acknowledgement / backchannel / interruption carry-forward / 短句节奏 做准备
- 输入/输出：明确 fast brain 未来行为层边界
- 不做什么：不把深检索和慢脑分析挪进 fast path
- 验收标准：后续实现者能基于任务描述扩展 fast brain，而不破坏快慢脑边界
