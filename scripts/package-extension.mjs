import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'manifest.json'), 'utf8'));
const files = [
  'manifest.json',
  'background.js',
  'content.js',
  'main-world.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'options.html',
  'options.css',
  'options.js',
  'shared/cleaner.js',
  'assets/icon16.png',
  'assets/icon32.png',
  'assets/icon48.png',
  'assets/icon128.png'
];
const missing = files.filter((file) => !existsSync(path.join(repositoryRoot, file)));

if (missing.length) {
  throw new Error(`打包缺少檔案：${missing.join(', ')}`);
}

const outputDirectory = path.join(repositoryRoot, 'dist');
const outputPath = path.join(outputDirectory, `clean-trail-v${manifest.version}.zip`);
await mkdir(outputDirectory, { recursive: true });

const result = spawnSync('zip', ['-q', '-r', outputPath, ...files], {
  cwd: repositoryRoot,
  stdio: 'inherit'
});

if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`zip 結束狀態：${result.status}`);

console.log(`已建立 ${path.relative(repositoryRoot, outputPath)}`);
