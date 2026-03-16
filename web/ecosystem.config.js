module.exports = {
  apps: [
    {
      name: "command-central",
      script: "npm",
      args: "start -- -p 3001",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
