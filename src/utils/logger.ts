export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

class Logger {
  private level: LogLevel;

  constructor(level: string = 'info') {
    this.level = level as LogLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage('debug', message), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(this.formatMessage('info', message), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage('warn', message), ...args);
    }
  }

  error(message: string, error?: any): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage('error', message));
      if (error) {
        console.error(error);
      }
    }
  }

  success(message: string): void {
    console.log(`✅ ${message}`);
  }

  failure(message: string): void {
    console.log(`❌ ${message}`);
  }

  section(title: string): void {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  ${title}`);
    console.log(`${'='.repeat(50)}\n`);
  }
}

export const logger = new Logger(process.env.LOG_LEVEL || 'info');
