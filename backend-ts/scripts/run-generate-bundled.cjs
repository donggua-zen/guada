const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
require(path.resolve(__dirname, '../node_modules/ts-node')).register;
require('ts-node').register({
  project: path.resolve(__dirname, '../tsconfig.json'),
  transpileOnly: true,
  compilerOptions: { module: 'commonjs' },
});
require(path.resolve(__dirname, 'generate-bundled-providers.ts'));
