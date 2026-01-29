import { z } from 'zod';
import { Logger } from '@nestjs/common';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'staging'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  ELEVEN_LABS_KEY: z.string().min(1, 'ELEVEN_LABS_KEY is required'),
  CLOUDINARY_CLOUD_NAME: z.string().min(1, 'CLOUDINARY_CLOUD_NAME is required'),
  CLOUDINARY_API_KEY: z.string().min(1, 'CLOUDINARY_API_KEY is required'),
  CLOUDINARY_API_SECRET: z.string().min(1, 'CLOUDINARY_API_SECRET is required'),
  DEFAULT_SENDER_EMAIL: z
    .string()
    .email('DEFAULT_SENDER_EMAIL must be a valid email'),
  DEFAULT_SENDER_NAME: z.string().min(1, 'DEFAULT_SENDER_NAME is required'),
  SUPPORT_EMAIL: z.string().email('SUPPORT_EMAIL must be a valid email').optional(),
  // SMTP Configuration (replaces Brevo)
  SMTP_HOST: z.string().min(1, 'SMTP_HOST is required'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  SMTP_USER: z.string().email('SMTP_USER must be a valid email'),
  SMTP_PASS: z.string().min(1, 'SMTP_PASS is required'),
  MAIL_ENCRYPTION: z.enum(['TLS', 'SSL']).optional().default('TLS'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  ADMIN_SECRET: z.string().min(1, 'ADMIN_SECRET is required'),
  SECRET: z.string().min(1, 'SECRET is required'),
  WEB_APP_BASE_URL: z.string().url('WEB_APP_BASE_URL must be a valid URL'),
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  BACKEND_BASE_URL: z.string().url('BACKEND_BASE_URL must be a valid URL'),
  DEEPGRAM_API_KEY: z.string().min(1, 'GOOGLE_TTS_API_KEY is required'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const validateEnv = (config: Record<string, unknown>) => {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const logger = new Logger('EnvValidation');
    logger.error(
      '❌ Invalid environment variables:',
      result.error.message,
      result.error.format(),
    );
    throw new Error('Invalid environment variables');
  }

  return result.data;
};
