export interface AppConfig {
  port: number;
  maxQueryRows: number;
  /** 服务对外可访问地址，用于远程配置下发时切换 SDK 上报目标 */
  publicHost: string;
  clickhouse: {
    url: string;
    database: string;
    username: string;
    password: string;
    autoInit: boolean;
  };
  mail: {
    host?: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
  };
  alertCheckInterval: number;
  realtime: {
    /** SSE 推送周期（毫秒） */
    pushIntervalMs: number;
    /** 推送失败后客户端重连基础退避（毫秒，指数递增） */
    retryBaseMs: number;
    /** 重连退避上限（毫秒） */
    retryMaxMs: number;
    /** 全局 SSE 连接上限（背压，超出返回 503） */
    maxClients: number;
  };
}

const toBool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export default (): AppConfig => ({
  port: Number(process.env.PORT || 8787),
  maxQueryRows: Number(process.env.MAX_QUERY_ROWS || 10000),
  publicHost: (process.env.PUBLIC_HOST || '').replace(/\/+$/, ''),
  clickhouse: {
    url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
    database: process.env.CLICKHOUSE_DATABASE || 'web_monitor',
    username: process.env.CLICKHOUSE_USERNAME || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    autoInit: toBool(process.env.CLICKHOUSE_AUTO_INIT, true),
  },
  mail: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: toBool(process.env.SMTP_SECURE, true),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.ALERT_MAIL_FROM || 'web-monitor <no-reply@example.com>',
  },
  alertCheckInterval: Number(process.env.ALERT_CHECK_INTERVAL || 60),
  realtime: {
    pushIntervalMs: Number(process.env.REALTIME_PUSH_INTERVAL_MS || 5_000),
    retryBaseMs: Number(process.env.REALTIME_RETRY_BASE_MS || 10_000),
    retryMaxMs: Number(process.env.REALTIME_RETRY_MAX_MS || 60_000),
    maxClients: Number(process.env.REALTIME_MAX_CLIENTS || 200),
  },
});
