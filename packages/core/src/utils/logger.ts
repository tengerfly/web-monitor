export interface Logger {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

const PREFIX = '[web-monitor]';

/** 创建带前缀的日志器；关闭 debug 时仅保留 warn/error 以便排查 SDK 自身问题 */
export function createLogger(enabled: boolean): Logger {
  return {
    debug: (...args: any[]) => {
      if (enabled) console.debug(PREFIX, ...args);
    },
    info: (...args: any[]) => {
      if (enabled) console.info(PREFIX, ...args);
    },
    warn: (...args: any[]) => {
      if (enabled) console.warn(PREFIX, ...args);
    },
    error: (...args: any[]) => {
      if (enabled) console.error(PREFIX, ...args);
    },
  };
}

export const noopLogger: Logger = {
  debug: () => void 0,
  info: () => void 0,
  warn: () => void 0,
  error: () => void 0,
};
