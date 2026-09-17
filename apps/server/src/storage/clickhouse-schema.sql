-- web-monitor ClickHouse 表结构
-- 定位：承载海量事件明细与统计聚合（PV/UV、趋势、P95、慢接口、错误检索、回放分片）
-- 分区策略统一为按月分区 + TTL，避免单分区无限膨胀。

CREATE DATABASE IF NOT EXISTS web_monitor;

-- ---------------------------------------------------------------------------
-- 统一事件明细表
-- 所有性能 / 行为 / 自定义埋点事件都落到这一张宽表；
-- 差异部分进 extra(JSON)，公共统计维度（设备/浏览器/地域/版本）独立成列以支持快速分组。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS web_monitor.wm_events
(
    app_key        LowCardinality(String),
    event_type     LowCardinality(String),
    category       LowCardinality(String),
    timestamp      DateTime64(3),
    session_id     String,
    user_id        String,
    anonymous_id   String,
    page_id        String,
    url            String,
    page_title     String,
    app_version    LowCardinality(String),
    env            LowCardinality(String),
    trace_id       String,
    -- 主维度名：指标名 / 事件名 / 接口 URL 模板 / 页面路径 / 元素选择器
    name           String,
    -- 主数值：指标值 / 耗时 / 深度 / 时长
    value          Float64,
    status         Int32 DEFAULT 0,
    success        UInt8 DEFAULT 1,
    extra          String DEFAULT '{}',
    context        String DEFAULT '{}',
    device_type    LowCardinality(String) DEFAULT '',
    device_brand   LowCardinality(String) DEFAULT '',
    browser        LowCardinality(String) DEFAULT '',
    browser_ver    LowCardinality(String) DEFAULT '',
    os             LowCardinality(String) DEFAULT '',
    geo_country    LowCardinality(String) DEFAULT '',
    geo_region     LowCardinality(String) DEFAULT '',
    geo_city       LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (app_key, event_type, category, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

-- ---------------------------------------------------------------------------
-- 错误明细表
-- 与 wm_events 分开存储：错误带 breadcrumbs / snapshot / frames 等大字段，
-- 且查询模式完全不同（按指纹归组、按用户检索、SourceMap 还原）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS web_monitor.wm_errors
(
    app_key        LowCardinality(String),
    timestamp      DateTime64(3),
    fingerprint    String,
    category       LowCardinality(String),
    level          LowCardinality(String),
    message        String,
    name           String,
    type           String DEFAULT '',
    stack          String DEFAULT '',
    frames         String DEFAULT '[]',
    filename       String DEFAULT '',
    lineno         Int32 DEFAULT 0,
    colno          Int32 DEFAULT 0,
    session_id     String,
    user_id        String,
    anonymous_id   String,
    page_id        String,
    url            String,
    app_version    LowCardinality(String),
    env            LowCardinality(String),
    trace_id       String DEFAULT '',
    breadcrumbs    String DEFAULT '[]',
    snapshot       String DEFAULT '{}',
    extra          String DEFAULT '{}',
    device_type    LowCardinality(String) DEFAULT '',
    browser        LowCardinality(String) DEFAULT '',
    os             LowCardinality(String) DEFAULT '',
    geo_country    LowCardinality(String) DEFAULT '',
    geo_region     LowCardinality(String) DEFAULT '',
    geo_city       LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (app_key, fingerprint, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY;

-- ---------------------------------------------------------------------------
-- 回放分片表
-- 回放数据量最大，独立 TTL（默认 30 天）以便单独控制存储成本。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS web_monitor.wm_replay
(
    app_key      LowCardinality(String),
    session_id   String,
    page_id      String,
    chunk_index  UInt32,
    timestamp    DateTime64(3),
    start_time   DateTime64(3),
    end_time     DateTime64(3),
    width        UInt32 DEFAULT 0,
    height       UInt32 DEFAULT 0,
    events       String,
    reasons      String DEFAULT '[]',
    app_version  LowCardinality(String) DEFAULT '',
    env          LowCardinality(String) DEFAULT '',
    device_type  LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (app_key, session_id, chunk_index)
TTL toDateTime(timestamp) + INTERVAL 30 DAY;

-- ---------------------------------------------------------------------------
-- 会话与访问明细（用于快速会话列表查询；可选物化视图方案见 README）
-- 由 wm_events 汇总而来，避免高频更新单行造成写放大。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS web_monitor.wm_sessions
(
    app_key        LowCardinality(String),
    session_id     String,
    user_id        String,
    anonymous_id   String,
    start_time     DateTime64(3),
    end_time       DateTime64(3),
    duration       Float64,
    page_views     UInt32,
    entry_url      String,
    exit_url       String,
    page_id        String,
    app_version    LowCardinality(String) DEFAULT '',
    env            LowCardinality(String) DEFAULT '',
    device_type    LowCardinality(String) DEFAULT '',
    browser        LowCardinality(String) DEFAULT '',
    os             LowCardinality(String) DEFAULT '',
    geo_country    LowCardinality(String) DEFAULT '',
    geo_region     LowCardinality(String) DEFAULT '',
    geo_city       LowCardinality(String) DEFAULT '',
    has_replay     UInt8 DEFAULT 0,
    updated_at     DateTime64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(start_time)
ORDER BY (app_key, session_id)
TTL toDateTime(start_time) + INTERVAL 180 DAY;
