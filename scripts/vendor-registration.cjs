const fs = require('node:fs');
const path = require('node:path');
const source = path.dirname(require.resolve('tus-js-client/package.json'));
fs.mkdirSync('vendor', { recursive: true });
fs.copyFileSync(path.join(source, 'dist/tus.min.js'), 'vendor/tus.min.js');
fs.copyFileSync(path.join(source, 'LICENSE'), 'vendor/tus-LICENSE');
