/**
 * Structured logger.
 *
 * Simple console logger with prefixed levels.
 * Replace with a proper logging library (pino, winston) if needed later.
 */

export function info(message: string, meta?: Record<string, unknown>): void {
  console.log(`[claudecord] ${message}`, meta ?? "");
}

export function error(message: string, meta?: Record<string, unknown>): void {
  console.error(`[claudecord:error] ${message}`, meta ?? "");
}

export function debug(message: string, meta?: Record<string, unknown>): void {
  if (process.env["DEBUG"]) {
    console.debug(`[claudecord:debug] ${message}`, meta ?? "");
  }
}
