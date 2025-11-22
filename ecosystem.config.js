module.exports = {
  apps: [
    {
      name: "storytime-staging-backend",
      script: "dist/main.js",
      cwd: "/var/www/storytime/staging/backend/current",
      env: {
        NODE_ENV: "staging",
        PORT: 3501
      }
    },
    {
      name: "storytime-prod-backend",
      script: "dist/main.js",
      cwd: "/var/www/storytime/prod/backend/current",
      env: {
        NODE_ENV: "production",
        PORT: 3502
      }
    }
  ]
}
