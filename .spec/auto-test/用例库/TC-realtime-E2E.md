# 用例库 — 实时大屏 E2E（/realtime）

> 三段式 setup→act→assert。执行环境：vite dev 5180 + mock 服务端 8787。视觉基准：设计稿 v4；对错基准：PRD V1 AC。
> 工具降级声明：环境无 Playwright+Midscene，使用会话内 Browser Use（GUI 自动化）执行，明示降级。

## TC-RT-E2E-01 首屏加载与七区块呈现【AC-M02-001/003】
- setup：mock 服务端 8787 在线（2 应用），打开 /realtime
- act：等待首帧快照渲染
- assert：默认选中应用列表第一项「演示商城」；七区块齐全（应用切换区/核心指标卡/实时趋势/错误滚动流/Top 榜/告警横幅/达标率）；统计时点有值；无 console error

## TC-RT-E2E-02 SSE 自动推进【AC-M02-004】
- setup：TC-01 后停留页面
- act：静置 ≥6s（≥1 个推送周期）
- assert：统计时点推进（generatedAt 更新）；无手动刷新动作；网络面板可见 /stream 连接存活

## TC-RT-E2E-03 应用切换与竞态【AC-M02-002/010】
- setup：TC-01 状态
- act：切换到「企业官网」；再快速连续点击回「演示商城」
- assert：区块按新应用重建（指标/错误流/top 榜 appKey 语境一致）；最终以最后选择为准；无残留旧应用数据；无 console error

## TC-RT-E2E-04 错误条目跳转详情【AC-M02-005】
- setup：TC-01 状态
- act：点击错误滚动流第一条
- assert：新开视图（新标签）指向 /errors/:fingerprint（fp-1 → /errors/fp-1）

## TC-RT-E2E-05 告警横幅五要素与定位【AC-M02-006】
- setup：TC-01 状态（mock 恒有 1 条未恢复告警）
- act：检查横幅内容并点击
- assert：五要素齐全（规则名/指标/当前值/阈值/触发时间）；点击新开视图至告警管理页并定位 a1

## TC-RT-E2E-06 超长文本截断与展开【AC-M02-012/SUM-16】
- setup：TC-01 状态
- act：找到截断的错误条目，点击「查看完整」
- assert：完整消息可见（role=note）；再收起恢复截断

## TC-RT-E2E-07 服务中断→失败横幅【AC-M02-007】
- setup：TC-01 状态正常显示
- act：杀掉 mock 服务端进程（真实断流注入）；静置 ≥12s（retry 退避 + 客户端超时窗口）
- assert：出现「更新失败」横幅 + 最后成功时点；页面不白屏不崩溃；自动重试进行中

## TC-RT-E2E-08 服务恢复→自动恢复【AC-M02-007 反向】
- setup：TC-07 失败横幅显示中
- act：重启 mock 服务端（新进程，验证端口重新监听）；静置 ≥15s
- assert：失败横幅消失、数据恢复推进；SSE 重连成功

## TC-RT-E2E-09 全程 console 卫生【NFR】
- setup：TC-01~08 全程
- act：收集 window error / unhandledrejection / console.error
- assert：0 error 级记录（警告单列）

## TC-RT-E2E-10 存量页面路由遍历（mock 环境边界内）
- setup：同环境
- act：依次访问 /overview /performance /errors /behavior /sessions /users /projects /alerts /connect
- assert：均不白屏、有页面骨架或空态/错误提示（数据为空属 mock 边界，真实数据行为不在本轮判定）
