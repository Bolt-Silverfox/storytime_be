const os = require('os');

const cpus = os.cpus().length;
const prodInstances = Math.max(2, cpus - 1);

const baseConfig = {
  script: 'dist/main.js',
  instances: 'max',
  exec_mode: 'cluster',
  autorestart: true,
  watch: false,
  max_memory_restart: '1G',
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
      // separate port. nginx routes blue.dev.api.storytimeapp.me -> :3600.
      // A modest instance count so it shares the box without starving green.
      ...baseConfig,
      name: 'storytime-api-blue',
      instances: 2,
      env: {
        NODE_ENV: 'development',
        PORT: 3600,
      },
    },
  ],
};
