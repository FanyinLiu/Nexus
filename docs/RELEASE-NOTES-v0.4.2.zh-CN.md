# Nexus v0.4.2 — Check-In 策略

状态：草稿。Klein 明确要求最终发布检查、tag 和 GitHub Release 之前，不要发布。

这个小版本继续保持 0.4 的桌面陪伴感知路线本地、保守。它只加固 Nexus 什么时候
可以考虑给出一句温和的 in-app check-in；不发消息、不执行工具、不做外部通知，
也不发布新版本。

## 变化

### 决策和发出分开

陪伴 check-in 策略现在可以先返回一个本地决策，而不是直接调度、渲染、持久化或
重复 UI。这样它可以安全地放在轮询里：重复调用时，会先被压制，不会变成反复出现
的提示。

### 重复 check-in 会被压住

这个策略补上了会让陪伴变成打扰的几类边界：

- 正在和 Nexus 聊天时，压制所有 check-in 信号
- 过期的“刚回到 Nexus”信号不会继续触发
- 同一个活动信号在发出窗口内不能重复出现
- 刚被用户 dismiss 的同类信号会继续保持安静
- 本地 in-app payload 可 dismiss，并且会很快过期

### In-app payload 只是被动数据

`buildCompanionCheckInInAppPayload` 只生成一个本地、会过期的数据对象。它不调度
定时器、不写入存储、不发送通知，也不调用工具。

## 仍然不做

这个版本不包含：

- 暂不发布正式 v0.4.2。
- 不改 package 版本号。
- 不打 tag，不创建 GitHub Release。
- 不切换 README 稳定版入口。
- 外部通知
- 发消息
- 工具执行
- 持久化 check-in 历史
- 跨会话延续 check-in 状态
- 新桌面感知来源
- 活动历史 UI
- 跟随鼠标、跟随打字、桌宠窗口控制

这些继续留给后续 0.4.x 或 0.5。

## 验证重点

发布前应覆盖：

- active chat 优先级
- quiet hours 和 cooldown
- focus suppression
- 过期 return-to-Nexus 窗口
- 同一信号重复压制
- dismiss 压制
- signal key 稳定性
- 被动 in-app payload 结构
- 五语言温和文案，不出现监控感或精确计时

建议先跑：

```bash
node --experimental-strip-types --test tests/companion-check-in-policy.test.ts
npx tsc -b --pretty false
```
