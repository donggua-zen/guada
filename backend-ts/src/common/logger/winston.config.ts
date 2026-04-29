import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import * as path from 'path';

/**
 * Winston 日志配置
 * 
 * 提供以下功能：
 * - 控制台彩色输出（开发友好）
 * - 错误日志文件按日期轮转，保留7天
 * - 综合日志文件按日期轮转，保留14天
 * - 自动压缩旧日志文件
 * - 单个文件大小限制防止过大
 */
export const createWinstonConfig = (logsDir?: string) => {
  // 默认日志目录为项目根目录下的 logs 文件夹
  const defaultLogsDir = path.join(process.cwd(), 'logs');
  const logDirectory = logsDir || defaultLogsDir;

  return {
    format: winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss',
      }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json(),
    ),
    transports: [
      // 控制台输出 - 使用 NestJS 风格格式化
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.ms(),
          nestWinstonModuleUtilities.format.nestLike('GuaDa-Backend', {
            colors: true,
            prettyPrint: true,
            processId: false,
            appName: true,
          }),
        ),
      }),

      // 错误日志文件 - 仅记录 error 级别，按日期轮转
      new winston.transports.DailyRotateFile({
        filename: path.join(logDirectory, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxFiles: '7d', // 保留7天
        maxSize: '20m', // 单个文件最大20MB
        zippedArchive: true, // 压缩旧日志
        auditFile: path.join(logDirectory, '.error-log-audit.json'),
      }),

      // 警告日志文件 - 记录 warn 及以上级别
      new winston.transports.DailyRotateFile({
        filename: path.join(logDirectory, 'warn-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'warn',
        maxFiles: '7d',
        maxSize: '30m',
        zippedArchive: true,
        auditFile: path.join(logDirectory, '.warn-log-audit.json'),
      }),

      // 综合日志文件 - 记录所有级别，保留时间更长
      new winston.transports.DailyRotateFile({
        filename: path.join(logDirectory, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxFiles: '14d', // 保留14天
        maxSize: '50m', // 单个文件最大50MB
        zippedArchive: true,
        auditFile: path.join(logDirectory, '.combined-log-audit.json'),
      }),
    ],
  };
};
