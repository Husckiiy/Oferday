import { EventEmitter } from 'events';
import { LogEntry } from '../types/index.js';

class LoggerService extends EventEmitter {
  private logs: LogEntry[] = [];
  private maxLogs: number = 200;

  public log(module: LogEntry['module'], level: LogEntry['level'], message: string, data?: any) {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
      level,
      module,
      message,
      data
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    const color = {
      info: '\x1b[36m', // Cyan
      warn: '\x1b[33m', // Yellow
      error: '\x1b[31m', // Red
      success: '\x1b[32m' // Green
    }[level] || '\x1b[0m';
    const reset = '\x1b[0m';
    const modTag = `\x1b[1m[${module}]\x1b[0m`;

    console.log(`${color}[${entry.timestamp}]${reset} ${modTag} ${color}${message}${reset}`, data ? data : '');

    this.emit('log', entry);
  }

  public info(module: LogEntry['module'], message: string, data?: any) {
    this.log(module, 'info', message, data);
  }

  public success(module: LogEntry['module'], message: string, data?: any) {
    this.log(module, 'success', message, data);
  }

  public warn(module: LogEntry['module'], message: string, data?: any) {
    this.log(module, 'warn', message, data);
  }

  public error(module: LogEntry['module'], message: string, data?: any) {
    this.log(module, 'error', message, data);
  }

  public getRecentLogs(): LogEntry[] {
    return [...this.logs];
  }

  public clearLogs(): void {
    this.logs = [];
    this.emit('cleared');
  }
}

export const logger = new LoggerService();
