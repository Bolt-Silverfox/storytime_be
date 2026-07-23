const os = require('os');

const cpus = os.cpus().length;
const prodInstances = Math.max(2, cpus - 1);

// Blue: single-instance v1.3.0 candidate (see the app entry below).
const blueInstances = 1;

// Single-instance apps run in fork mode; a lone cluster instance just spawns a
// wasteful cluster master + worker pair (and was a source of leaked Prisma
// query-engine processes on crash-loops). Only cluster when scaled past 1.
const execModeFor = (instances) => (instances > 1 ? 'cluster' : 'fork');

const baseConfig = {
  script: 'dist/main.js',
  instances: 'max',
  exec_mode: 'cluster',
  autorestart: true,
  watch: false,
  max_memory_restart: '1G',
  // Stop infinite crash-loops: the app must stay up `min_uptime` to count as a
  // successful boot; after `max_restarts` rapid failures pm2 marks the process
  // `errored` and stops restarting it (instead of thrashing the CPU forever).
  min_uptime: '15s',
  max_restarts: 10,
  restart_delay: 4000,
};

module.exports = {
  apps: [
    {
      ...baseConfig,
      name: 'storytime-api-development',
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      ...baseConfig,
      name: 'storytime-api-staging',
      env: {
        NODE_ENV: 'staging',
      },
    },
    {
      ...baseConfig,
      name: 'storytime-api-production',
      instances: prodInstances,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      // Blue: v1.3.0 candidate, runs on the SAME host as green (dev) on a
      // separate port. nginx routes blue.dev.api.storytimeapp.me -> :3601.
      // Single instance + a small DB pool (see connection_limit in the blue
      // .env) so it can't starve the shared RDS / green on the same box.
      ...baseConfig,
      name: 'storytime-api-blue',
      instances: blueInstances,
      exec_mode: execModeFor(blueInstances),
      env: {
        NODE_ENV: 'development',
        PORT: 3601,
      },
    },
  ],
};
