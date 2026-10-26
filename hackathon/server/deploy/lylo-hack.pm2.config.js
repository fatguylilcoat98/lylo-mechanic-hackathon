// PM2 config for the hackathon server on the Dell (no secrets here).
// Start: pm2 start hackathon/server/deploy/lylo-hack.pm2.config.js   (from repo root)
// Loopback only; no tunnel route. Does not touch other PM2 apps.
const path = require('path');
const server = path.resolve(__dirname, '..');
module.exports = {
  apps: [{
    name: 'lylo-hack',
    cwd: server,
    script: path.join(server, '.venv/bin/gunicorn'),
    args: "-b 127.0.0.1:5088 -w 2 --timeout 30 'lylo_hack.app:create_app()'",
    interpreter: 'none',
    autorestart: true,
    max_restarts: 10,
    env: {
      LYLO_HACK_DISABLE_EXTERNAL_HANDSHAKE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
  }],
};
