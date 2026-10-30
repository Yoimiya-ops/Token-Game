import fs from 'node:fs';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/server/package.json'));
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('tsup')] }));
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

// Resolve with Node to support pnpm links and restricted Windows parent directories.
const nodeFiles = {
  name: 'node-files',
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (builtins.has(args.path) || args.path.startsWith('node:')) return { path: args.path, external: true };
      const base = args.importer ? path.dirname(args.importer) : root;
      const resolver = createRequire(path.join(base, '__bundle__.cjs'));
      let resolved;
      if (args.path.startsWith('.') || path.isAbsolute(args.path)) {
        const target = path.resolve(base, args.path);
        resolved = [target, ...['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json'].map(ext => target + ext), path.join(target, 'index.ts')]
          .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      }
      resolved ??= resolver.resolve(args.path);
      return { path: resolved, namespace: 'node-file' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'node-file' }, args => {
      const extension = path.extname(args.path);
      const loader = extension === '.json' ? 'json' : extension === '.tsx' ? 'tsx' : extension === '.ts' ? 'ts' : 'js';
      return { contents: fs.readFileSync(args.path, 'utf8'), loader };
    });
  }
};
for (const name of ['index', 'cli', 'companion/collector']) {
  await build({
    absWorkingDir: root,
    entryPoints: [path.join(root, 'apps/server/src', `${name}.ts`)],
    outfile: path.join(root, 'apps/server/dist', `${path.basename(name)}.cjs`),
    bundle: true, platform: 'node', target: 'node20', format: 'cjs',
    tsconfigRaw: { compilerOptions: { target: 'ES2022', esModuleInterop: true } },
    plugins: [nodeFiles], logLevel: 'info'
  });
}
