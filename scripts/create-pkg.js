import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.join(__dirname, "../packages");

const pkgName = process.argv[2]; // 从命令行参数获取包名
if (!pkgName) {
  console.error("请指定包名，例如: pnpm create-pkg my-pkg");
  process.exit(1);
}

const pkgDir = path.join(packagesDir, pkgName);
if (fs.existsSync(pkgDir)) {
  console.error(`包 ${pkgName} 已存在！`);
  process.exit(1);
}

// 创建目录
fs.mkdirSync(pkgDir, { recursive: true });

// 生成 package.json
const pkgJson = {
  name: `@web-monitor/${pkgName}`,
  version: "1.0.0",
  main: "src/index.ts",
  module: "dist/index.esm.js",
  scripts: {
    build: "tsup src/index.ts --dts",
    dev: "tsup src/index.ts --dts --watch",
  },
  publishConfig: {
    main: "dist/index.js",
  },
  type: "module",
  files: ["dist"],
  author: "海阔天空",
  license: "ISC",
  dependencies: {
    // 自动添加 workspace 协议
    "shared-utils": "workspace:*",
  },
  devDependencies: {
    tsup: "^7.0.0",
    typescript: "^5.0.0",
  },
};

fs.writeFileSync(
  path.join(pkgDir, "package.json"),
  JSON.stringify(pkgJson, null, 2),
);

console.log(`✅ 包 ${pkgName} 初始化完成！`);
