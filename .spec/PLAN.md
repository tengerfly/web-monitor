# PLAN.md — RealtimeModule 功能点清单

| # | 功能点 | Files | 状态 |
|---|---|---|---|
| FP1 | types 契约 + realtime 配置项 | packages/types/src/realtime.ts、index.ts；apps/server/src/config/configuration.ts | ✅ |
| FP2 | RealtimeModule（聚合 + TTL 缓存 + 失败标记 + SSE/REST + 背压） | apps/server/src/modules/realtime/realtime.module.ts | ✅ |
| FP3 | vitest 用例（承接 TDD Gherkin：正向/边界/异常/并发/协议） | apps/server/src/modules/realtime/realtime.module.spec.ts | ✅ 14/14 |
| FP4 | 注册 + env + 全局验证（typecheck/lint/build/test） | app.module.ts、.env.example、package.json | ✅ |
