module.exports = {
  apps: [
    {
      name: 'bot-promocoes',
      script: './dist/server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
