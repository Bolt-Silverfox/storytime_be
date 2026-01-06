const baseConfig = {
  script: 'dist/src/main.js',
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
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
