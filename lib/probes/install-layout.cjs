// 在宿主仓库根目录执行：把 package.json、锁文件摘要与 pnpm workspace 声明写成一份 JSON。
// 不读取 secrets、依赖树或运行产物。
const { readdirSync, readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const result = { manifests: {}, lockfiles: {}, workspaces: {} };
const ignored = new Set(['node_modules', '.git', '.niceeval', '.venv', 'venv', '__pycache__', '.next', 'dist', 'build']);
const locks = new Set(['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb']);
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !ignored.has(entry.name)) visit(path);
    if (!entry.isFile()) continue;
    if (entry.name === 'package.json') {
      const pkg = JSON.parse(readFileSync(path, 'utf8'));
      result.manifests[path] = Object.fromEntries(
        ['name', 'type', 'packageManager', 'scripts', 'dependencies', 'devDependencies', 'workspaces']
          .filter(key => Object.hasOwn(pkg, key)).map(key => [key, pkg[key]])
      );
    } else if (locks.has(entry.name)) {
      result.lockfiles[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
    } else if (entry.name === 'pnpm-workspace.yaml') {
      result.workspaces[path] = readFileSync(path, 'utf8');
    }
  }
}
visit('.');
process.stdout.write(JSON.stringify(result));
