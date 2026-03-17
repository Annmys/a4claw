module.exports = {
  apps: [{
    name: 'clawdagent',
    script: 'dist/index.js',
    node_args: '--max-old-space-size=1024',
    max_memory_restart: '800M',
    env: {
      NODE_ENV: 'production',
    },
    // Restart strategy — don't rapid-fire restart on crashes
    exp_backoff_restart_delay: 1000,
    max_restarts: 10,
    min_uptime: '10s',
    // Logs
    error_file: '/root/.pm2/logs/clawdagent-error.log',
    out_file: '/root/.pm2/logs/clawdagent-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }],
};
