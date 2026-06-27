const os = require('os');

const cpus = os.cpus().length;
const parseInstanceCount = (rawValue, fallback) => {
  if (rawValue == null || rawValue === '') {
    return fallback;
  }

  const parsedValue = parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

const devInstances = parseInstanceCount(process.env.PM2_DEV_INSTANCES, 1);
const stagingInstances = parseInstanceCount(
  process.env.PM2_STAGING_INSTANCES,
  1,
);
const prodInstances = parseInstanceCount(
  process.env.PM2_PROD_INSTANCES,
  Math.max(2, cpus - 1),
);

const baseConfig = {
  script: 'dist/src/main.js',
  autorestart: true,
  watch: false,
  max_memory_restart: '1G',
};

module.exports = {
  apps: [
    {
      ...baseConfig,
      name: 'storytime-api-development',
      instances: devInstances,
      exec_mode: devInstances > 1 ? 'cluster' : 'fork',
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      ...baseConfig,
      name: 'storytime-api-staging',
      instances: stagingInstances,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'staging',
      },
    },
    {
      ...baseConfig,
      name: 'storytime-api-production',
      instances: prodInstances,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
