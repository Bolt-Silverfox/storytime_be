import { z } from 'zod';
import { Logger } from '@nestjs/common';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
  ELEVEN_LABS_KEY: z.string().min(1, 'ELEVEN_LABS_KEY is required'),
  CLOUDINARY_CLOUD_NAME: z.string().min(1, 'CLOUDINARY_CLOUD_NAME is required'),
  CLOUDINARY_API_KEY: z.string().min(1, 'CLOUDINARY_API_KEY is required'),
  CLOUDINARY_API_SECRET: z.string().min(1, 'CLOUDINARY_API_SECRET is required'),
  DEFAULT_SENDER_EMAIL: z.string().email('DEFAULT_SENDER_EMAIL must be a valid email'),
  DEFAULT_SENDER_NAME: z.string().min(1, 'DEFAULT_SENDER_NAME is required'),
  BREVO_API_URL: z.string().url('BREVO_API_URL must be a valid URL'),
  BREVO_API_KEY: z.string().min(1, 'BREVO_API_KEY is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  SECRET: z.string().min(1, 'SECRET is required'),
  WEB_APP_BASE_URL: z.string().url('WEB_APP_BASE_URL must be a valid URL'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const validateEnv = (config: Record<string, unknown>) => {
  const result = envSchema.safeParse(config);
  
  if (!result.success) {
    const logger = new Logger('EnvValidation');
    logger.error('❌ Invalid environment variables:', result.error.message, result.error.format());
    throw new Error('Invalid environment variables');
  }
  
  return result.data;
}; 