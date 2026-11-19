import { build } from 'esbuild';
const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['electron'], sourcemap: false, minify: false, logLevel: 'warning' };
await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'out/main/main.js' });
await build({ ...common, entryPoints: ['src/main/preload.ts'], outfile: 'out/preload/preload.js' });
console.log('main/preload built');
