/**
 * Content-Security-Policy directives scoped to the Swagger UI route (`/docs`).
 *
 * The API applies Helmet's strict default CSP globally (`script-src 'self'`,
 * which blocks inline scripts). Swagger UI (swagger-ui-express) injects an
 * inline init script plus inline styles, so under the strict default CSP the
 * `/docs` page is CSP-broken. Rather than weaken the CSP for the whole API,
 * these directives relax ONLY what swagger-ui needs and are mounted scoped to
 * `/docs` (see `main.ts`), leaving every other route on the strict default.
 *
 * Deliberately NOT relaxed: `'unsafe-eval'` (swagger-ui does not need it),
 * `default-src`, `object-src`, `base-uri` — those stay at Helmet's strict
 * defaults via `useDefaults` (unspecified directives are not overridden).
 */
export const swaggerCspDirectives: Record<string, string[]> = {
  scriptSrc: ["'self'", "'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
  imgSrc: ["'self'", 'data:', 'https:'],
};
