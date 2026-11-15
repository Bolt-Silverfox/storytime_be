# Bull Board queue dashboard

Served at `/api/v1/admin/queues` (assets and the `/api/queues` JSON and action endpoints live under the same path).

Access is HTTP Basic auth. Set both `BULL_BOARD_USER` and `BULL_BOARD_PASSWORD` (production: SSM `/storytime-prod/api/BULL_BOARD_USER` and `/storytime-prod/api/BULL_BOARD_PASSWORD`).

If either is unset or blank the dashboard is not served: every request under the path returns 404, including requests that carry credentials.

The password must be at least 24 characters after trimming (use 32+ random characters, e.g. `openssl rand -base64 32`). A shorter password is treated as unset: the dashboard returns 404 and a warning is logged at boot. Surrounding whitespace in either value is ignored.

Each client address (`req.ip`) is limited to 10 failed attempts per 15 minutes; further requests, including correct ones, get 429 with `Retry-After` until the window expires. Behind a proxy this relies on the trust-proxy hop count being configured, otherwise all clients share one address.
