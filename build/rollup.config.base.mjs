import path from 'node:path';
import { existsSync } from 'node:fs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';

const toPascal = (name) =>
  name
    .replace(/^@[^/]+\//, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');

/**
 * SDK 包统一构建配置：ESM(.mjs) / CJS(.cjs) / UMD / UMD-min + 类型声明(.d.ts)
 * 产物扩展名刻意区分，避免 package.json "type" 歧义导致 Node 解析错误。
 */
export function createRollupConfig({ pkg, dir }) {
  const depNames = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ];
  const isExternal = (id) =>
    /^node:/.test(id) || depNames.some((dep) => id === dep || id.startsWith(`${dep}/`));

  const umdName = toPascal(pkg.name);
  const globals = Object.fromEntries(depNames.map((dep) => [dep, toPascal(dep)]));

  const banner = `/*! ${pkg.name} v${pkg.version} | MIT License | Enterprise Web Monitor */`;
  // 入口自动探测：优先 .ts，其次 .tsx（框架适配包使用 JSX）
  const input = [
    path.join(dir, 'src', 'index.ts'),
    path.join(dir, 'src', 'index.tsx'),
  ].find((file) => existsSync(file));
  if (!input) {
    throw new Error(`[${pkg.name}] entry not found: expect src/index.ts or src/index.tsx`);
  }
  const tsconfig = path.join(dir, 'tsconfig.json');

  const umdOutput = (file, plugins = []) => ({
    file: path.join(dir, file),
    format: 'umd',
    name: umdName,
    globals,
    banner,
    sourcemap: true,
    plugins,
  });

  return [
    {
      input,
      external: isExternal,
      plugins: [
        nodeResolve({ browser: true, preferBuiltins: false }),
        commonjs(),
        typescript({
          tsconfig,
          declaration: false,
          declarationMap: false,
          sourceMap: true,
          inlineSources: true,
          noEmitOnError: false,
          outputToFilesystem: false,
        }),
      ],
      output: [
        { file: path.join(dir, 'dist/index.mjs'), format: 'es', banner, sourcemap: true },
        {
          file: path.join(dir, 'dist/index.cjs'),
          format: 'cjs',
          exports: 'named',
          banner,
          sourcemap: true,
        },
        umdOutput('dist/index.umd.js'),
        umdOutput('dist/index.umd.min.js', [terser({ format: { comments: /^!/ } })]),
      ],
    },
    {
      input,
      external: isExternal,
      plugins: [dts({ respectExternal: true })],
      output: { file: path.join(dir, 'dist/index.d.ts'), format: 'es' },
    },
  ];
}

export default createRollupConfig;
