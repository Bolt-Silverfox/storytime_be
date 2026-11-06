import { INestApplication, RequestMethod } from '@nestjs/common';

export const API_V1_PREFIX = 'api/v1';
export const API_V2_ROUTE_BASE = 'api/v2';

export function applyApiPrefix(app: INestApplication): void {
  app.setGlobalPrefix(API_V1_PREFIX, {
    exclude: [
      { path: `${API_V2_ROUTE_BASE}/*path`, method: RequestMethod.ALL },
    ],
  });
}
