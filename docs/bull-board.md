# Bull Board queue dashboard

Served at `/api/v1/admin/queues` (assets and the `/api/queues` JSON and action endpoints live under the same path).

Access is HTTP Basic auth. Set both `BULL_BOARD_USER` and `BULL_BOARD_PASSWORD` (production: SSM `/storytime-prod/api/BULL_BOARD_USER` and `/storytime-prod/api/BULL_BOARD_PASSWORD`).

If either is unset or blank the dashboard is not served: every request under the path returns 404, including requests that carry credentials.
