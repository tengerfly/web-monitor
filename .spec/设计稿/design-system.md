# 设计规范（Design System）— web-monitor 实时大屏

> UI-UX-Design 步骤 5 产出物。风格基线：用户选定的「方案 C · 冷辉电蓝」（见 `.spec/设计稿/_style-proposal/style-proposal.md`，色板实见后拍板）。
> 所有生成调用必带本文件 + 保真约束语：只使用本规范定义的字体/颜色/间距/组件，不得引入规范外视觉。
> 组件基线：shadcn/ui 暗色 token 结构（主色换 blue 系）；图表层级优先。

## 0. 设计原则
| 原则 | 说明 |
|---|---|
| 异常才出声 | 正常态安静克制；只有错误/告警使用暖色与强调，杜绝满屏高亮 |
| 远距离可读 | 关键数字大号高对比；正文层级三级分明；面板间以底色差与 1px 描边区分 |
| 图表主角 | 趋势区与达标率环是视觉主角，其余区块为数字与列表服务 |

## 1. 色彩系统
### 1.1 基础色
| Token | 色值 | 用途 |
|---|---|---|
| `--color-primary` | `#60A5FA` | 主色（选中态、主曲线、环形图、主按钮） |
| `--color-primary-hover` / `-subtle` | `#93C5FD` / `rgba(96,165,250,0.12)` | 悬停 / 浅底 |
| `--color-accent` | `#22D3EE` | 点缀（第二曲线「错误数」用危险色，青色仅用于链接 hover 过渡） |
| `--color-bg` | `#0A0F1E` | 页面背景（深蓝黑） |
| `--color-surface` | `#101828` | 卡片/面板 |
| `--color-surface-2` | `#16203A` | 次级面板（侧边栏、表头底） |
| `--color-text` | `#E8EFFB` | 正文 |
| `--color-text-secondary` / `-tertiary` | `#7D8CA6` / `#55617A` | 辅助 / 弱提示 |
| `--color-border` | `#1E2A45` | 描边/分割线 |
### 1.2 语义色（含浅底对）
| Token | 色值（浅底对） | 用途 |
|---|---|---|
| `--color-success(-subtle)` | `#4ADE80` / `rgba(74,222,128,0.12)` | 成功、正常更新中、达标环 |
| `--color-warning(-subtle)` | `#FACC15` / `rgba(250,204,21,0.10)` | 警告、部分失败就地标注 |
| `--color-danger(-subtle)` | `#F87171` / `rgba(248,113,113,0.12)` | 错误、告警横幅、醒目态 |
| `--color-info(-subtle)` | `#60A5FA` / `rgba(96,165,250,0.12)` | 信息、链接 |

## 2. 字体排版
| Token | 字号/字重/行高 | 用途 |
|---|---|---|
| `--font-number` | `40px / 700 / 1.1`（tabular-nums） | 指标卡大数字（远距离可读核心） |
| `--font-h1` | `22px / 600 / 1.3` | 页内主标题（大屏页弱化页标题，突出数据） |
| `--font-h2` | `15px / 600 / 1.4` | 区块标题 |
| `--font-h3` | `13px / 600 / 1.4` | 榜单小标题 |
| `--font-body` | `14px / 400 / 1.6` | 正文 |
| `--font-caption` | `12px / 400 / 1.5` | 辅助/时间戳 |
- 字体族：`Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`（离线可用，数字启用 font-variant-numeric: tabular-nums）；禁止引入需联网第三方字体。

## 3. 间距系统（4px 网格）
`--space-1..8 = 4/8/12/16/24/32/40/48px`；卡片内距 16px，区块间距 16px，页面留白 24px；Web 常规触控/点击目标 ≥32px。

## 4. 圆角与阴影
| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm / -md / -lg / -full` | `4 / 6 / 10px / 999px` | 标签/输入 / 卡片按钮 / 弹层 / 胶囊 |
| `--shadow-md / -lg` | `0 4px 12px rgba(0,0,0,0.35)` / `0 8px 28px rgba(0,0,0,0.45)` | 悬浮 / 弹层（克制，深色底弱阴影） |

## 5. 组件规范
### 5.1 侧边导航（看板框架）
宽 200px、底 `--color-surface-2`；项高 40px、圆角 `--radius-sm`、左右距 8px；激活项底 `--color-primary-subtle`、文字与左侧 3px 指示条 `--color-primary`；非激活文字 `--color-text-secondary`；存量页项带 11px 弱化徽标。
### 5.2 应用切换区（区块 A）
应用选择器：高 36px、圆角 `--radius-sm`、底 `--color-surface-2`、描边 `--color-border`，聚焦描边 `--color-primary`；统计时点为 caption 级「时:分 + 服务端时间」灰字，数字部分 text 强调；更新状态徽标：● 正常（success）/ ✕ 更新失败（danger 加粗）。
### 5.3 指标卡（区块 B）
7 列网格（间距 12px）；卡内距 16px、底 `--color-surface`、描边 `--color-border`、圆角 `--radius-md`；名称 caption 灰、数值 `--font-number`；醒目卡（命中告警阈值）数值 `--color-danger` 并带 4px 底部指示条；hover 提亮描边（200ms）。
### 5.4 趋势面板（区块 C）
面板底 `--color-surface`；双曲线：访问量 `--color-primary`、错误数 `--color-danger`（2px）；网格线 `--color-border`；图例右上 caption 级；空态：居中「暂无数据——该应用尚未产生上报」tertiary 灰。
### 5.5 错误滚动流（区块 D）
行高约 64px、分隔线 `--color-border`；行结构：[错误类型 danger 加粗 + 「新」danger 浅底胶囊] / 消息正文（截断+「查看完整」primary 文字按钮）/ [页面 primary 链接 + 时间 caption 灰]；行 hover 底 `--color-primary-subtle`；整行点击新开视图跳详情。
### 5.6 Top 榜（区块 E）
三列小标题 h3 灰；行：序号 tertiary + 名称（截断）+ 数值强调右对齐；行高 28px。
### 5.7 告警横幅（区块 F）
横幅头部条 `--color-danger` 底白字「告警 · 未恢复」；条目底 `--color-danger-subtle`、规则名 danger 加粗、meta caption；hover 加深；无未恢复告警时整区块不渲染。
### 5.8 达标率区（区块 G）
SVG 环形：底环 `--color-border`、进度环 `--color-primary`（pathLength 100，线宽 2.5-4px）；百分比强调数字（可置于环心或环下，二选一全站统一，本稿采用环心式）；综合达标率与单项以竖分隔线区分。另注：§1.2 success 用于「成功/正常」语义文本，达标环进度色统一 primary（以本条为准）。
### 5.9 更新失败/首次失败横幅
更新失败：`--color-danger-subtle` 底、danger 描边，文案含「最后成功统计时点」强调；首次失败同结构、文案「暂无已加载数据（无历史统计时点）」；应用被删：`--color-warning-subtle` 底 warning 描边。

## 6. 界面状态
空数据：各区块独立空态（tertiary 灰居中文案，正常态语义，禁用警示色）；加载中：区块 45% 透明 + 「加载中…」primary 文字；更新失败：横幅 + 旧数据保持；部分失败：失败区块就地 warning 标注且数值置空；应用被删：warning 横幅 + 内容降透明。零值态与异常态严格区分（零值=正常态视觉）。

## 7. 页面宽度与动效
设计视口 1440px（内容区自适应，最小 1280）；断点不保留移动端。动效强度档=「克制流动」：数据刷新淡入 200ms ease-out；「新」条目一次性高亮脉冲 2.5s；曲线推进 300ms；悬停 150ms 提亮；无入场编排、无循环装饰动效。

## 8. CSS 变量 Token 汇总（§7 对账基线）
| # | Token | 值 |
|---|---|---|
| 1 | --color-primary | #60A5FA |
| 2 | --color-primary-hover | #93C5FD |
| 3 | --color-primary-subtle | rgba(96,165,250,0.12) |
| 4 | --color-accent | #22D3EE |
| 5 | --color-bg | #0A0F1E |
| 6 | --color-surface | #101828 |
| 7 | --color-surface-2 | #16203A |
| 8 | --color-text | #E8EFFB |
| 9 | --color-text-secondary | #7D8CA6 |
| 10 | --color-text-tertiary | #55617A |
| 11 | --color-border | #1E2A45 |
| 12 | --color-success | #4ADE80 |
| 13 | --color-success-subtle | rgba(74,222,128,0.12) |
| 14 | --color-warning | #FACC15 |
| 15 | --color-warning-subtle | rgba(250,204,21,0.10) |
| 16 | --color-danger | #F87171 |
| 17 | --color-danger-subtle | rgba(248,113,113,0.12) |
| 18 | --color-info | #60A5FA |
| 19 | --color-info-subtle | rgba(96,165,250,0.12) |
| 20 | --font-number | 40px/700/1.1 tabular-nums |
| 21 | --font-h1 | 22px/600/1.3 |
| 22 | --font-h2 | 15px/600/1.4 |
| 23 | --font-h3 | 13px/600/1.4 |
| 24 | --font-body | 14px/400/1.6 |
| 25 | --font-caption | 12px/400/1.5 |
| 26 | --font-family | Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif |
| 27 | --space-1..8 | 4/8/12/16/24/32/40/48px |
| 28 | --radius-sm/-md/-lg/-full | 4/6/10px/999px |
| 29 | --shadow-md | 0 4px 12px rgba(0,0,0,0.35) |
| 30 | --shadow-lg | 0 8px 28px rgba(0,0,0,0.45) |
| 31 | --motion-fade | 200ms ease-out |
| 32 | --motion-curve | 300ms ease |
| 33 | --motion-hover | 150ms |
| 34 | --viewport | 1440px 设计视口（min 1280） |
