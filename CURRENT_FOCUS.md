# CURRENT_FOCUS.md

## 一句话

Memory V2 基础设施已全部就绪 —— 写路径双写（V1 sharedMoments + V2 episode store），proactive planner 已建好，等真实数据验证后切读路径。

## 当前最高优先级

Memory V2 验证 + 读路径迁移（V2.1）

## 当前进度

### Memory V2 基础设施（已完成）
- ✅ `llm/embedding_client.ts`：OpenAI 兼容 embedding 客户端（nomic-embed-text, 768 维）
- ✅ `storage/schema.sql`：新增 `episodes` 表 + 向量索引；`memories.embedding` 改为 768 维
- ✅ `storage/repositories/episode_repository.ts`：insert / update / findSimilar / getByUser / getUnresolved / delete
- ✅ `storage/repositories/vector_utils.ts`：共享向量工具函数
- ✅ `memory/episode_store.ts`：ingest（语义合并 / 新建） / findRelevant（综合分排序） / listUnresolved / markReferenced
- ✅ `brains/proactive_planner.ts`：关系阶段门控 + 退避门控 + 冷却门控 → care / follow_up / presence
- ✅ `brains/slow_brain.ts`：写路径双写 — V1 recordSharedMoment + V2 episodeStore.ingest
- ✅ `brains/slow_brain_store.ts`：getSnapshot() 派生缓存 memoize
- ✅ 22+ 单测全部通过

### 待做：V2.1 读路径迁移（需要先有真实 episode 数据验证）
- ⏳ `memory/memory_agent.ts::recallEpisodes()` 改为调 `episodeStore.findRelevant()`
- ⏳ `brain/prompt_builder.ts` episode 注入段改为 episode store 结果
- ⏳ `server/session/index.ts::fireSilenceNudge()` 改调 `proactive_planner.planProactiveNudge()`
- ⏳ 清理 V1 episode 路径（删除 `buildEpisodes` / `buildTopicThreads` / `PersistentEpisode`）

### 下一步
1. **验证写路径**：配置 embedding 服务，跑真实对话，检查 episodes 表有数据写入
2. **V2.1 读路径迁移**：确认 episode 数据质量后切读路径
3. **T-040**：情绪推断 + 多维表情协议（可并行）

## 当前非目标
- 不先做前端口型同步（T-032）
- 不先做前端 emoji 展示（T-035.5）
- 不做 V1 episode 路径的强制删除（等读路径切完后自然清理）

## 环境变量新增（Memory V2）
- `REM_EMBEDDING_BASE_URL` — embedding 服务地址（如 `http://localhost:11434/v1`）
- `REM_EMBEDDING_API_KEY` — API key（Ollama 可填任意值）
- `REM_EMBEDDING_MODEL` — 模型名（默认 `nomic-embed-text`）

## 执行规则
- 当前主线程内的代码任务做完后，必须回写对应任务文档状态
- 至少更新 `TASKS.md` 中对应的任务状态
- 如果本次改动改变了当前主线程判断或交付边界，也要同步更新本文件
- 不要只改代码不改任务文档，否则下一个 agent 很容易误判当前进度
