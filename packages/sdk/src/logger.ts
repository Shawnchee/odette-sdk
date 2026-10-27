// Adapted from thetanuts-sdk src/utils/logger.ts and src/types/logger.ts at
// 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Renamed to OdetteLogger. consoleLogger prefix changed to [ODETTE:*]. The
// Logger wrapper swallows errors thrown by a caller's logger: a log call runs
// after a fill is mined and must never turn it into a reported failure.

/**
 * Logger interface for the Odette SDK
 * All methods are optional - if not provided, logging is silently skipped
 */
export interface OdetteLogger {
  debug?(msg: string, meta?: unknown): void;
  info?(msg: string, meta?: unknown): void;
  warn?(msg: string, meta?: unknown): void;
  error?(msg: string, meta?: unknown): void;
}

/**
 * No-op logger implementation that silently discards all log messages
 */
export const noopLogger: OdetteLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Console logger implementation for development/debugging
 */
export const consoleLogger: OdetteLogger = {
  debug: (msg: string, meta?: unknown) => {
    // eslint-disable-next-line no-console
    console.debug(`[ODETTE:DEBUG] ${msg}`, meta !== undefined ? meta : '');
  },
  info: (msg: string, meta?: unknown) => {
    // eslint-disable-next-line no-console
    console.info(`[ODETTE:INFO] ${msg}`, meta !== undefined ? meta : '');
  },
  warn: (msg: string, meta?: unknown) => {
    // eslint-disable-next-line no-console
    console.warn(`[ODETTE:WARN] ${msg}`, meta !== undefined ? meta : '');
  },
  error: (msg: string, meta?: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`[ODETTE:ERROR] ${msg}`, meta !== undefined ? meta : '');
  },
};

/**
 * Logger wrapper that safely calls logger methods
 * Handles cases where logger methods may be undefined
 */
export class Logger {
  private logger: OdetteLogger;

  constructor(logger?: OdetteLogger) {
    this.logger = logger ?? noopLogger;
  }

  debug(msg: string, meta?: unknown): void {
    this.call('debug', msg, meta);
  }

  info(msg: string, meta?: unknown): void {
    this.call('info', msg, meta);
  }

  warn(msg: string, meta?: unknown): void {
    this.call('warn', msg, meta);
  }

  error(msg: string, meta?: unknown): void {
    this.call('error', msg, meta);
  }

  /** Logging is best-effort: a throwing logger must never change the outcome. */
  private call(level: keyof OdetteLogger, msg: string, meta?: unknown): void {
    try {
      this.logger[level]?.(msg, meta);
    } catch {
      // ignore
    }
  }
}
