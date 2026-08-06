# Nexus 自治 / 记忆 / 上下文系统接通度审计

**审计日期**：2026-04-12
**审计范围**：`src/features/autonomy/*` · `src/features/memory/*` · `src/features/context/*`（共 28 个核心 .ts 文件）
**审计目的**：验证已经写好的系统是否真的影响 LLM 的 system prompt，还是只在内存里飘
**评分维度**：从代码 grep 出来的事实链路，**不是**主观质量评价
**唯一裁判**：项目作者本人 2 周连续使用后的体感

---

## 评分标准

| 标记 | 含义 |
|---|---|
| ✅ | 输出最终被 `systemPromptBuilder.ts` 或 `memoryInjection.ts` 拼进 prompt，模型真的看得到 |
| 🟡 | 输出影响行为（触发 UI notice / 控制门控）但**不进 prompt**，模型对此一无所知 |
| 🔴 | 代码完整但输出**完全没有下游消费者**，纯空跑 |
| ❌ | dead code / stub，未被任何地方调用 |

**关键认知**：🟡 和 🔴 不是同一回事。🟡 是"接到了别的地方"，🔴 是"接到了一个空气插座"。Nexus 的核心问题主要是 🔴。

---

## 总览结论（先看这个）

### 三条最致命的发现（已经亲自 grep 验证）

1. **🔴 `relationshipTracker` 的 score 从未进入 prompt**
   - `formatRelationshipForPrompt()` 在 `relationshipTracker.ts:121` 被定义
   - `useAutonomyController.ts:55` import 它
   - `useAutonomyController.ts:600` 把它包成 `getRelationshipPrompt` getter
   - **整个 src/ 里没有任何代码调用这个 getter**
   - `systemPromptBuilder.ts` grep `relationship` → **0 hit**
   - **结论**：这个分数被 tick 一直在更新，被 storage 一直在持久化，但模型从来不知道你们的关系如何

2. **🔴 `emotionModel` 的 emotion 从未进入 prompt**
   - 完全相同的模式：`formatEmotionForPrompt` 定义于 `emotionModel.ts:127`，包成 getter 在 `useAutonomyController.ts:597`，**0 个消费者**
   - `systemPromptBuilder.ts` grep `emotion` → **0 hit**
   - **结论**：她的 4 维情绪状态在内存里飘，但模型回复时根本不知道她现在是高兴还是担心

3. **🔴 `innerMonologue` 不影响后续对话**
   - innerMonologue 是**独立的 LLM 调用**（`useAutonomyController.ts:284-361`），结果被显示为 UI bubble 或 debug log
   - `systemPromptBuilder.ts` grep `monologue` → **0 hit**
   - **结论**：她"思考"了什么，对她接下来跟你说话的方式**没有任何影响**。这是纯视觉特效。

### 一条同样致命但稍轻的发现

4. **❌ `goalTracker` 完全 dead code**
   - 被 `proactiveEngine.ts` import，但代码里没有实际调用 `evaluateGoalReminders` 的地方
   - 被 tick 调度链遗忘
   - **结论**：删掉或接通

### 真正接通了的部分（这部分是 README 卖点中"为真"的那一半）

| 真接通了 | 验证锚点 |
|---|---|
| `narrativeMemory` | `systemPromptBuilder.ts:74` 直接调用 `formatNarrativeForPrompt()` |
| `desktopContext` | `systemPromptBuilder.ts:124` 调用 `formatDesktopContext()` |
| `recall.ts` (memory hot/warm 三层) | `systemPromptBuilder.ts:134-148` 通过 `buildHotTierMemorySections` + `buildSemanticMemorySection` |
| `decay.ts` / `coldArchive.ts` / `clustering.ts` | 在 `useMemoryDream.ts:213-234` 真的会跑（dream cycle 触发） |
| `skillDistillation` | 通过把 skill 写进 memory，间接进 prompt |

---

## AUTONOMY/ — 14 文件逐项

### 🔴 `relationshipTracker.ts` — 关系分数（致命空跑）
- **产出**：0-100 关系分数 + 亲密度等级 + 称呼偏好
- **链路**：`formatRelationshipForPrompt()` 定义于行 121 → 在 `useAutonomyController.ts:600` 被包成 `getRelationshipPrompt` getter → **0 个消费者**
- **调度**：✅ 被 tick 维护（`useAutonomyController.ts:279`），状态被写入 storage
- **修复成本**：⭐ 极低 —— 在 `systemPromptBuilder.ts` 加一个 `relationshipSection`
- **修复后效果预期**：**直接显著**。模型会知道"今天是第 47 天，你们已经从陌生变得熟悉"，称呼会自然演化。这是 README 卖点的核心，砍掉这条 README 半边脸都没了。

### 🔴 `emotionModel.ts` — 情绪状态（致命空跑）
- **产出**：4 维情绪 (energy / warmth / curiosity / concern) + decay
- **链路**：`formatEmotionForPrompt()` 定义于行 127 → `useAutonomyController.ts:597` getter → **0 个消费者**
- **副作用消费**：`emotionToPetMood()` 会被 Live2D 用于切换表情 —— 所以 emotion **影响 Live2D 但不影响 LLM**
- **调度**：✅ 被 tick 维护，被 signal apply 调用
- **修复成本**：⭐ 极低
- **修复后效果预期**：**直接显著**。她的回复会因为她现在的情绪有不同温度。配合 Live2D 表情同步，模态一致性会大幅提升。

### 🔴 `innerMonologue.ts` — 内心独白（致命空跑 + 概念错位）
- **产出**：thought + urgency + optional speech，**通过独立 LLM 调用生成**
- **链路**：在 `useAutonomyController.ts:284-361` 独立运行，结果作为 UI bubble 显示或 debug console
- **关键事实**：每次产出的 thought **没有被存进任何 memory 缓冲**，也没有被注入下一轮 prompt
- **调度**：✅ 被 tick 调度，受 `shouldRunMonologue()` 和 counter 控制
- **修复成本**：⭐⭐ 中低 —— 需要决定"独白如何影响后续对话"的产品语义：
  - **方案 A**：把最近 N 个 monologue thought 注入下一轮 prompt 的 "你最近在想：..." section
  - **方案 B**：把高 urgency 的 thought 直接转成短期 memory 条目（5 分钟 TTL）
  - **方案 C**：让独白的 speech 字段直接进 chat 流（她真的会自言自语出来）—— 但要控制频率
- **修复后效果预期**：**这是真正能让她"有内心生活"的关键**。当前是空特效。

### 🟡 `proactiveEngine.ts` — 主动决策（接通了但不进 prompt）
- **产出**：ProactiveDecision (speak / brief / remind / suggest / silent)
- **链路**：决策被 `useAutonomyController.ts:157-234` 读取并触发 `chat.pushCompanionNotice()` —— 这是**独立的 notice 流程**，会真的让她说话，但不进 system prompt
- **调度**：✅ 被 tick 调用，受 rhythmLearner 门控
- **状态判定**：🟡 不是 🔴 —— 因为它真的会触发 chat。但模型**不知道她"自己决定"开口的原因**，只是看到一个新消息。
- **修复必要性**：可选。如果想让她在主动开口的回复里表现得"我是因为某某原因决定来跟你说话"，需要把 ProactiveDecision 的 reason 也注入 prompt。

### 🟡 `rhythmLearner.ts` — 作息学习（接通了但仅作门控）
- **产出**：24 小时活动概率分布 + `shouldAllowProactiveSpeech()` 门控
- **链路**：✅ 门控函数在 `useAutonomyController.ts:177` 被调用，控制 proactive 是否执行；但**学到的作息不进 prompt**
- **调度**：✅ 每 tick 调用 applyWeeklyDecay；recordInteraction 被 markInteraction 调用
- **dead 函数**：`formatRhythmSummary()` 未被任何地方调用 —— 这个被定义出来明显是想往 prompt 注入的，但没接通
- **修复成本**：⭐ 极低
- **修复后效果预期**：模型会知道"用户最近熬夜很多" / "用户中午通常在吃饭"，回复会有时间感知。

### 🔴 `goalTracker.ts` — 目标追踪（dead code）
- **产出**：Goal 评估 + urgency 计算
- **链路**：被 `proactiveEngine.ts` import 但**无实际调用**。grep 显示仅 import 行有引用，业务逻辑零调用
- **调度**：❌ 未被任何 tick 调用
- **决策**：要么接通（goalTracker 应该在 proactiveEngine 评估时贡献 urgency 信号），要么删掉

### 🟡 `intentPredictor.ts` — 意图预测（接通了但仅触发 UI action）
- **产出**：DecisionQueue + 延迟决策调度
- **链路**：被 `useAutonomyController.ts` 维护，dequeueReady 在 tick 中被调用，但产出的 scheduled decisions 仅触发 UI notice，不进 prompt
- **调度**：✅ tick 中调用
- **状态判定**：和 proactiveEngine 同类，行为引擎而非 prompt modifier

### 🟡 `focusAwareness.ts` — 焦点感知（控制信号，不进 prompt）
- **产出**：FocusState 分类 + autonomy 抑制标志
- **链路**：✅ 被 proactiveEngine 评估和 tickLoop 中读取，用于 suppress autonomy
- **状态判定**：作为门控很合理，**不一定需要进 prompt**。但如果想让她说"看你最近一直在认真写代码，我就不打扰你了"，需要让她**知道自己为什么没说话** —— 那就要把 FocusState 也喂进 prompt。

### ✅ `memoryDream.ts` — 梦境周期（真的在跑）
- **产出**：DreamOperations (new/update/prune)，通过 LLM 生成
- **链路**：`buildDreamPrompt` 在 `useMemoryDream.ts:87` 被调用，response 被 parseDreamResponse 处理，操作被应用于 memory list → 进 recall → 进 prompt
- **调度**：✅ 触发条件 `shouldRunDream()`（phase === 'sleeping'）
- **状态**：唯一一个 autonomy 模块**完全接通且功能闭环**的

### ✅ `skillDistillation.ts` — 技能提炼（接通）
- **产出**：Skill extraction + formatting
- **链路**：`buildSkillDistillationPrompt` 在 `useMemoryDream.ts:123` 调用，提炼出来的 skill 被加入 memory → 进 recall → 进 prompt
- **状态**：接通且闭环

### 🟡 `decisionFeedback.ts` — 决策反馈（内部状态）
- **产出**：DecisionFeedbackState，影响 proactive 冷却
- **链路**：纯 autonomy 内部，不进 prompt
- **状态**：作为内部门控合理

### 🟡 `contextScheduler.ts` — 上下文调度（触发 UI action）
- **产出**：Context-triggered tasks 评估
- **链路**：触发 UI notice / search / memory_dream action
- **状态**：行为层而非 prompt 层，合理

### 🟡 `tickLoop.ts` — Tick 引擎（控制流）
- **产出**：AutonomyTickState (phase / idle / etc)
- **链路**：tickState 被传给 evaluateProactiveContext、buildMonologuePrompt —— **进了独立 LLM 调用，但不进主对话 prompt**
- **状态**：作为协调器合理

### N/A `index.ts`
- 模块出口，re-export

---

## MEMORY/ — 12 文件逐项

memory 目录是 Nexus **唯一一个完全接通的子系统**。基本上每个文件都是 ✅。

### ✅ `memory.ts` — 排序 / 评分基础
- 被 `recall.ts` 调用 → 进 prompt

### ✅ `decay.ts` — 重要度衰减
- `getDecayedScore` 在 vectorSearch 中被调用（每次 recall 都用）
- `applyDecayBatch` 在 dream cycle 中被调用 (`useMemoryDream.ts:213`)
- ✅ 接通

### ✅ `coldArchive.ts` — 冷归档
- `identifyArchiveCandidates` + `archiveMemories` 在 `useMemoryDream.ts:232-234` 被调用
- ✅ 接通

### ✅ `recall.ts` — 记忆召回（核心入口）
- `buildMemoryRecallContext` 在 `assistantReply.ts:210` 被调用
- 返回的 context 被 `buildHotTierMemorySections` (`systemPromptBuilder.ts:134`) 和 `buildSemanticMemorySection` (`systemPromptBuilder.ts:148`) 拼进 prompt
- ✅ **直接进 prompt**

### ✅ `clustering.ts` — 聚类
- 在 `useMemoryDream.ts:216-227` 被调用，cluster 信息更新 memory relations → 进 narrativeMemory rebuild → 进 prompt
- ✅ 接通

### ✅ `narrativeMemory.ts` — 叙事线程
- `formatNarrativeForPrompt()` 在 `systemPromptBuilder.ts:74` 被**直接调用**，输出在行 139 拼入 prompt
- `buildNarrativeFromMemories` 在 `useMemoryDream.ts:240` 被 dream cycle 重建
- ✅ **直接进 prompt** —— 这是 README 卖点 "narrative threads" 的真实落点

### ✅ `vectorSearch.ts` — 向量搜索
- `cosineSimilarity` 在 `recall.ts` 中调用 → 进 prompt
- ✅ 接通

### ⚠️ `vectorSearchRuntime.ts` — runtime stub
- 文件极小（~1859 字节），需要单独检查是否真的有运行时调用 `window.vectorSearch`
- **跟进项**：下次审计单独验证

### ✅ `archive.ts`, `constants.ts`, `components/index.ts`, `index.ts` — 辅助
- 全部接通，无问题

---

## CONTEXT/ — 4 文件逐项

### ✅ `desktopContext.ts` — 桌面上下文
- `formatDesktopContext` 在 `systemPromptBuilder.ts:17` import，行 124 调用，输出在行 153 拼入 prompt（条件：`contextAwarenessEnabled`）
- ✅ **直接进 prompt** —— README 卖点真实

### ❌ `gameContext.ts` — 游戏上下文（dead）
- `options.gameContext` 在 `systemPromptBuilder.ts:126` 被读取进 prompt
- **但 `gameContext` 字段在 AssistantReplyRequestOptions 里从未被任何调用方填充**
- **没有任何代码生成 gameContext 数据**
- 状态：类型定义存在，prompt 拼接代码存在，但**永远是空字符串**，被 `.filter(Boolean)` 过滤掉
- **决策**：要么填实现（如果你真要做游戏感知），要么删除

### ✅ `browserScreenOcr.ts` — 浏览器 OCR（已删除）
- 文件仅 82 字节
- 未被任何地方调用
- **结果**：已删除

### N/A `index.ts`
- 模块出口

---

## 修复路径（按 ROI 排序）

### 🥇 修复 1：接通 emotion + relationship → prompt（成本 ⭐ / 价值 ⭐⭐⭐⭐⭐）

**这是整个 audit 里最高 ROI 的修复**。代价是 ~10 行代码，价值是让两个完整的子系统从空跑变成核心卖点。

具体改动（4 处）：

```typescript
// 1. systemPromptBuilder.ts AssistantReplyRequestOptions 加字段
emotionState?: EmotionState
relationshipState?: RelationshipState

// 2. buildSystemPrompt 内部加两个 section
const emotionSection = options.emotionState
  ? formatEmotionForPrompt(options.emotionState)
  : ''
const relationshipSection = options.relationshipState
  ? formatRelationshipForPrompt(options.relationshipState)
  : ''

// 3. 把这两行加进 prompt 数组（建议放在 narrativeSection 之后、header 之前
//    —— 因为情绪 / 关系是"她现在的状态"，应该影响"她是谁"的表达）

// 4. 在 chat orchestrator（assistantReply.ts 或 useChat）调用
//    buildChatRequestPayload 时，从 useAutonomyController 暴露的 ref
//    或 getter 取 emotionState / relationshipState 一起传入
```

### 🥈 修复 2：接通 rhythmLearner.formatRhythmSummary → prompt（成本 ⭐ / 价值 ⭐⭐⭐）

`formatRhythmSummary()` 已经写好了（被定义为 export 但 0 调用）。同样的接通模式：加 option 字段 → 加 section → 拼进数组。让她知道用户的作息节奏，回复会有时间感知。

### 🥉 修复 3：让 innerMonologue 影响下一轮对话（成本 ⭐⭐ / 价值 ⭐⭐⭐⭐⭐）

需要先做产品决策（方案 A/B/C 三选一，见上文 innerMonologue 段）。决策后改动也很小：增加一个 ring buffer 存最近 N 个 thought，在 buildSystemPrompt 里加 "你最近想到的事" section。

**这是让 Nexus 真的"有内心生活"的关键**。当前 innerMonologue 是纯视觉特效。

### 🔧 清理 4：处理 dead code

- `goalTracker.ts`：决定接通还是删除
- `gameContext.ts`：决定填实现还是删除
- ~~`browserScreenOcr.ts`~~：已删除
- `useAutonomyController.ts:597-600`：getEmotionPrompt / getRelationshipPrompt 这两个 getter 在修复 1 之后变得多余，也可以删

### 🔍 验证 5：确认 vectorSearchRuntime 是否真的在跑

文件极小，下次审计时需要单独 trace 是否有运行时调用。

---

## 修复完成后的真实状态

修复 1 + 2 + 3 完成后（保守估计 1-2 天工作量），README 上"自治 + 记忆 + 上下文"三套系统的卖点**全部为真**：

| 卖点 | 修复前 | 修复后 |
|---|---|---|
| narrative threads | ✅ | ✅ |
| dream cycle | ✅ | ✅ |
| 3-tier memory | ✅ | ✅ |
| desktop context | ✅ | ✅ |
| relationship 影响对话 | 🔴 空跑 | ✅ |
| emotion 影响对话 | 🔴 空跑（仅影响表情） | ✅ |
| inner monologue 有意义 | 🔴 视觉特效 | ✅ |
| rhythm learning 影响行为 | 🟡 仅作 gate | ✅ |

而且这整个修复**完全没有新建任何系统** —— 全都是接通已有代码。

---

## 这份审计的核心结论（一句话）

**Nexus 的瓶颈不是缺功能，而是过去几个月写的 autonomy 系统里有一半（emotion / relationship / monologue）从来没有真正接到 LLM 上 —— 它们一直在内存里飘。修复成本极低，价值极高。下一步应该是接电源，不是建新房子。**
