# PROJECT.md — RealtimeModule（实时大屏）增量开发档案

> 存量基建（P0–P7）之外的首个流水线管理增量；进度总览以 `.spec/PIPELINE.md` 为唯一状态源，本文件与 PLAN.md 记录开发侧细节。

## 现状基线（S1 盘点结论）
- 服务端：NestJS 11 单体 + Prisma(PostgreSQL) + @clickhouse/client(ClickHouse)；单文件模块风格（Controller/Service 同文件）；ResponseInterceptor 统一 JSON 包裹；AllExceptionsFilter 兜底；无鉴权中间件。
- 契约：`packages/types` 为三端唯一类型源（README 铁律）。
- 测试：服务端此前无测试设施（test 为占位脚本）；本次为 realtime 模块接入 vitest。

## 关键决策（继承 TDD V1 overview §2/§9）
SSE 推送（5s）/REST 快照兜底；进程内 TTL 缓存（TTL=推送周期）；连接背压 200；无新表；computeScore 从 overview 模块导出复用。

## 已知工程坑（现状基线）
- `apps/server` tsconfig `incremental: true` + 过期 `tsconfig.build.tsbuildinfo` 会让 `nest build` 静默输出空产物（exit 0）。修复后如再遇构建"成功但 dist 为空"，先删 `*.tsbuildinfo`。
