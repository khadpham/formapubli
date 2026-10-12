module.exports = {
  apps: [{
    name: 'formapubli-dev',
    cwd: '/opt/formapubli-dev',
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p 3002',
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'development', PORT: '3002' },
  }]
};
