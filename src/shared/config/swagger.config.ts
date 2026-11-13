import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const isSwaggerEnabled = (env: NodeJS.ProcessEnv): boolean =>
  (env.NODE_ENV ?? 'production') !== 'production' ||
  env.SWAGGER_ENABLED === 'true';

export const setupSwagger = (
  app: INestApplication,
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  if (!isSwaggerEnabled(env)) return false;

  const config = new DocumentBuilder()
    .setTitle('Storytime API')
    .setDescription('The Storytime API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
  return true;
};
