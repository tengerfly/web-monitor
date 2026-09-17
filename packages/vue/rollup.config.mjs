import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRollupConfig } from '../../build/rollup.config.base.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'));

export default createRollupConfig({ pkg, dir });
