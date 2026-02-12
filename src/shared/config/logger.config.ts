import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import * as winston from 'winston';

// Environment-based log level
const logLevel = process.env.LOG_LEVEL || 'info';
const nodeEnv = process.env.NODE_ENV || 'development';

const sensitiveKeys = [
  'password',
  'token',
  'authorization',
  'secret',
  'creditCard',
  'accessToken',
  'refreshToken',
  'passwordHash',
];

const redactSensitive = winston.format((info) => {
  const traverse = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;

    for (const key in obj) {
      if (
        sensitiveKeys.some((k) => key.toLowerCase().includes(k.toLowerCase()))
      ) {
        obj[key] = '***REDACTED***';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        // Limit depth if needed, but for now simple recursion
        traverse(obj[key]);
      }
    }
  };

  // Traverse the info object (including metadata)
  traverse(info);
  return info;
});

// Custom format for development (colorized, pretty-printed)
const devFormat = winston.format.combine(
  redactSensitive(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.ms(),
  nestWinstonModuleUtilities.format.nestLike('Storytime', {
    colors: true,
    prettyPrint: true,
  }),
);

// Custom format for production (JSON, structured)
const prodFormat = winston.format.combine(
  redactSensitive(),
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// Create Winston logger instance
export const winstonConfig: winston.LoggerOptions = {
  level: logLevel,
  format: nodeEnv === 'production' ? prodFormat : devFormat,
  transports: [
    // Console transport (always enabled)
    new winston.transports.Console({
      format: nodeEnv === 'production' ? prodFormat : devFormat,
    }),

    // File transport for errors (production only)
    ...(nodeEnv === 'production'
      ? [
          new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            format: prodFormat,
          }),
          new winston.transports.File({
            filename: 'logs/combined.log',
            format: prodFormat,
          }),
        ]
      : []),
  ],
  // Prevent crashes from logger errors
  exitOnError: false,
};
