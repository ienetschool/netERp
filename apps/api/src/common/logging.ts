import pino from 'pino';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.refreshToken',
  '*.password',
  '*.token',
];

export function pinoLoggerFactory() {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'erp-api' },
  });
}

export const logger = pinoLoggerFactory();
