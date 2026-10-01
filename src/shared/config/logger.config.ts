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
    // Console is the only transport we declare: logs leave the process on
    // stdout and the supervisor persists them (pm2 -> ~/.pm2/logs, and the
    // container log driver under the containerised deploy). Do not add File
    // transports here. The two removed ones were production-only (so they only
    // ever fired in the container image and the pm2 production app, never in
    // dev/staging), wrote cwd-relative logs/*.log with no maxsize/maxFiles, and
    // made a non-root container fail at boot with
    // `EACCES: permission denied, mkdir 'logs'` against a root-owned /app.
    // NB: @opentelemetry/instrumentation-winston appends its own transport to
    // this array at configure() time, but only when
    // @opentelemetry/winston-transport is installed - it currently is not, so
    // today it does trace-id correlation only and does not export log records.
    new winston.transports.Console({
      format: nodeEnv === 'production' ? prodFormat : devFormat,
    }),
  ],
  // Prevent crashes from logger errors
  exitOnError: false,
};
