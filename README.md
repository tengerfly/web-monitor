# web-monitor · 企业级前端监控基建

> 一次部署，后续所有前端项目「改配置即可接入」。
> **性能监控与用户行为追踪物理分离、按需引入**；错误与问题溯源作为独立能力包，用 `traceId + sessionId` 把四类数据串联起来。

[![CI](https://github.com/tengerfly/web-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/tengerfly/web-monitor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

---

## 为什么做这个

市面上的开源前端监控各有取舍：

| 参考项目 | 强项 | 我们补齐的部分 |
|---|---|---|
| [kisslove/web-monitoring](https://github.com/kisslove/web-monitoring) | 平台形态完整（多站点、告警、Docker） | 引入 SDK 分层与按需打包，性能与行为解耦 |
| [a597873885/webfunny_monitor](https://github.com/a597873885/webfunny_monitor) | 三合一（监控 + APM + 埋点），能力上限高 | 开源可复用的实现，而非仅服务端 + 商业版 |
| [clouDr-f2e/monitor](https://github.com/clouDr-f2e/monitor) | 多包 SDK、hooks 定制、测试完善 | 补齐服务端、可视化看板与源码级溯源闭环 |

本项目的差异化：

1. **性能 / 行为 硬分离** —— `@web-monitor/performance` 与 `@web-monitor/behavior` 各自独立安装、独立启停，互不牵连，体积按需付费。
2. **溯源优先** —— 错误发生时自动携带「行为轨迹（breadcrumbs）+ 接口调用链 + 现场快照」，并可直接跳到该会话的 DOM 回放。
3. **统一协议** —— SDK / 服务端 / 看板共用 `@web-monitor/types` 作为唯一契约定义源，避免三端字段漂移。
4. **成本可控** —— 三层采样（全局 → 能力包 → 事件）+ 服务端远程配置下发，出问题时先降采样保业务，而不是先下线监控。

---

## 架构总览

```
┌────────────────── 业务应用 ──────────────────┐
│  原生 Web  │  React  │  Vue 3  │（未来）小程序 │
└───────┬──────┬──────────┬───────────────────┘
        │      │          │
┌───────┴──────┴──────────┴───────┐
│      @web-monitor/core          │  底座：会话 / 上下文 / 上报管道 / 埋点 API
└──┬────────┬────────┬────────┬───┘
   │        │        │        │
┌──┴───┐ ┌──┴────┐ ┌─┴────┐ ┌─┴──────┐
│perf  │ │behavior│ │error │ │replay  │   四个能力包可任意组合安装
└──────┘ └───────┘ └──────┘ └────────┘
        │
        ▼   统一上报协议（HTTP / sendBeacon）
┌─────────────────────────────────────┐
│        apps/server (NestJS)         │
│ 上报网关 → 清洗/脱敏/地域 → 批量落库   │
│ SourceMap 还原 · 聚合查询 · 告警引擎  │
└────┬──────────────────────┬─────────┘
     │                      │
┌────┴─────────┐    ┌───────┴────────┐
│ PostgreSQL   │    │  ClickHouse    │
│ 应用/错误分组 │    │ 事件明细/回放   │
│ SourceMap/告警│    │ 趋势聚合 (TTL) │
└──────────────┘    └────────────────┘
     │
┌────┴─────────────────────────────────┐
│      apps/dashboard (React + AntD)   │
└──────────────────────────────────────┘
```

---

## 功能清单

完整清单见 [`docs/01-功能清单.md`](./docs/01-功能清单.md)，摘要如下。

### 性能监控 `@web-monitor/performance`
Core Web Vitals（LCP / INP / CLS）· FCP / TTFB / FID / FP / FMP / TTI · 加载阶段拆解（DNS/TCP/TLS/请求/响应/DOM 解析）· 长任务与 TBT · FPS 与卡顿 · 内存占用 · 慢资源与资源瀑布 · 慢接口与 P95/P99 · SPA 路由耗时 · 网络质量 · 白屏检测

### 用户行为追踪 `@web-monitor/behavior`
PV / UV / 会话 / 跳出率 · 页面停留（含前台可见时长）· 路由跳转 · 点击行为（选择器 + 坐标 + 属性）· 元素曝光 · 滚动深度 · 表单交互（默认脱敏）· 控制台采集 · 自定义埋点 · 用户路径 · 漏斗 · 点击热力图

### 错误与问题溯源 `@web-monitor/error`
JS 错误 / Promise 未捕获 / 资源加载失败 / 接口错误 / 框架错误 · 错误指纹聚合 · SourceMap 源码级还原 · **行为轨迹 Breadcrumbs** · **接口调用链** · **错误现场快照** · 四维关联（错误 ↔ 用户 ↔ 行为 ↔ 性能）· 告警规则

### 会话回放 `@web-monitor/replay`
DOM 全量快照 + 增量变更（MutationObserver）· 鼠标/滚动/视口/输入录制 · 隐私遮罩（默认遮罩输入框）· 分片上报 · 数据结构对齐 rrweb · 自研轻量播放器（进度、倍速、错误标记跳转）

### 服务端与看板
上报网关（鉴权/限流/清洗/二次脱敏/地域）· 远程配置下发 · PostgreSQL + ClickHouse 双存储 · SourceMap 管理 · 聚合查询 API · 告警引擎（邮件 / Webhook / 钉钉 / 企微 / 飞书）· 10 个看板页面 · Docker 一键部署

---

## 快速开始

### 环境要求

- Node.js ≥ 18.18（推荐 20/22）
- pnpm ≥ 9（项目使用 pnpm workspace）
- Docker（用于启动 PostgreSQL 与 ClickHouse）

### 1. 启动依赖与初始化

```bash
pnpm install

# 启动 PostgreSQL(5432) + ClickHouse(8123)
pnpm infra:up

# 复制并确认环境变量
cp apps/server/.env.example apps/server/.env

# 初始化数据库
pnpm db:generate        # 生成 Prisma 客户端
pnpm db:migrate         # 建表（PostgreSQL）
pnpm db:ch              # 建表（ClickHouse）
pnpm db:seed            # 初始化演示应用 wm_demo00000001
```

### 2. 启动服务端与看板

```bash
pnpm build:packages     # 先构建 SDK（看板与示例依赖其产物）
pnpm dev:server         # http://127.0.0.1:8787/api/v1
pnpm dev:dashboard      # http://127.0.0.1:5180
```

### 3. 产生一些数据

```bash
pnpm --filter @web-monitor/playground dev   # http://127.0.0.1:5190
```

示例页面上的按钮可分别触发：性能指标、行为埋点、同步/异步错误、404/500 接口、表单交互与回放录制。
操作后回到看板（`http://127.0.0.1:5180`）即可看到数据，并在「错误与溯源」中查看行为轨迹与会话回放。

---

## 接入到你的项目

### 按需组合

```bash
# 只监控性能
pnpm add @web-monitor/core @web-monitor/performance

# 只追踪用户行为
pnpm add @web-monitor/core @web-monitor/behavior

# 性能 + 错误溯源
pnpm add @web-monitor/core @web-monitor/performance @web-monitor/error

# 全量
pnpm add @web-monitor/core @web-monitor/performance @web-monitor/behavior @web-monitor/error @web-monitor/replay
```

### 最小示例

```ts
import { createMonitor } from '@web-monitor/core';
import { performancePlugin } from '@web-monitor/performance';
import { errorPlugin } from '@web-monitor/error';

const monitor = createMonitor({
  appKey: 'wm_xxxxxxxx',
  host: 'https://monitor.example.com',
  env: 'production',
  appVersion: '1.4.2',
  plugins: [
    performancePlugin({ slowApiThreshold: 1000 }),
    errorPlugin({ maxBreadcrumbs: 30, businessCodeExtractor: (data) => data?.code }),
  ],
});

monitor.start();

// 用户登录后绑定身份，串联登录前后的行为
monitor.identify('user_10086', { plan: 'pro' });

// 自定义埋点
monitor.track('order_submit', { orderId: 'A2026' });
```

### React

```tsx
import { MonitorProvider, MonitorErrorBoundary, useTrack } from '@web-monitor/react';

<MonitorProvider options={{ appKey, host, plugins: [...] }}>
  <MonitorErrorBoundary fallback={<div>页面异常，已自动上报</div>}>
    <App />
  </MonitorErrorBoundary>
</MonitorProvider>;
```

### Vue 3

```ts
import { createWebMonitorPlugin, installRouterTracking } from '@web-monitor/vue';

const monitor = createWebMonitorPlugin({ appKey, host, plugins: [...] });
app.use(monitor);
installRouterTracking(router, monitor.instance);
```

更多细节见 [`docs/04-接入指南.md`](./docs/04-接入指南.md)。

---

## 目录结构

```
web-monitor/
├── packages/                  # 采集 SDK（pnpm workspace，独立发版）
│   ├── types/                 # 上报协议与查询契约（三端唯一定义源）
│   ├── core/                  # 底座：生命周期、上报管道、会话、上下文、插件体系
│   ├── performance/           # 性能监控
│   ├── behavior/              # 用户行为追踪
│   ├── error/                 # 错误监控与问题溯源
│   ├── replay/                # 会话回放（录制器 + 播放器）
│   ├── react/                 # React 适配
│   └── vue/                   # Vue 3 适配
├── apps/
│   ├── server/                # 上报网关与查询服务（NestJS + Prisma + ClickHouse）
│   └── dashboard/             # 可视化看板（React + AntD + ECharts）
├── examples/playground/       # 端到端联调示例
├── docs/                      # 功能清单、架构设计、上报协议、接入指南
├── build/                     # 统一 Rollup 构建工厂
└── docker-compose.yml         # PostgreSQL + ClickHouse（+ 可选 MailHog）
```

---

## 开发指南

```bash
pnpm build:packages   # 构建全部 SDK
pnpm build:apps       # 构建服务端 + 看板
pnpm typecheck        # 全量类型检查
pnpm lint             # ESLint
pnpm test             # 单元测试（vitest，按包执行）
pnpm changeset        # 记录变更，用于 SDK 发版
```

**注意事项**

- SDK 包之间**不允许互相依赖**（只允许依赖 `core` 与 `types`），否则按需引入的树摇会失效。
- 任何上报字段变更，必须先修改 `packages/types` 与 `docs/03-上报协议.md`，再同步三端。
- 采集器内部的所有逻辑都必须做异常隔离（继承 `BaseCollector` 即可），监控自身绝不能影响业务。

---

## 路线图

- [x] P0 工程化：monorepo、统一构建、规范、CI、Docker 编排
- [x] P1 需求与架构：功能清单、架构设计、上报协议
- [x] P2 SDK 底座：`types` + `core`
- [x] P3 能力包：`performance` / `error` / `behavior` / `replay`
- [x] P4 框架适配：`react` / `vue`
- [x] P5 服务端：网关 + 存储 + 查询 + SourceMap + 告警
- [x] P6 看板：10 个页面
- [x] P7 示例与文档
- [ ] P8 扩展：小程序 / Node 端探针、APM 后端链路、实时大屏、可视化圈选埋点

---

## License

[MIT](./LICENSE)
