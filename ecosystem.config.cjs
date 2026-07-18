module.exports = {
  apps: [
    {
      name: 'ratiospread-expiry-strategy',
      script: './dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=512',
      autorestart: true,
      cron_restart: '20 8 * * *',
      stop_exit_codes: [0],
      exp_backoff_restart_delay: 100,
      watch: false,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      min_uptime: '10s',
      max_restarts: 10,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        TZ: 'UTC',
      },
    },
  ],
};
