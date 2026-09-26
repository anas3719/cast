const fs = require('node:fs');
fs.mkdirSync('public-service', { recursive: true });
fs.writeFileSync('public-service/index.html', '<!doctype html><meta charset="utf-8"><title>Cast Admin</title><a href="https://anas3719.github.io/cast/cast-admin.html">Cast Admin</a>');
