#!/usr/bin/env node
// Build macOS binaries using @yao-pkg/pkg
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

if (!existsSync(path.join(root, 'dist', 'index.js'))) {
  console.error('dist/index.js not found. Run npm run build first.');
  process.exit(1);
}

mkdirSync(path.join(root, 'binaries'), { recursive: true });

console.log('Building macOS binaries...');

try {
  execSync(
    [
      'npx @yao-pkg/pkg',
      'dist/index.js',
      '--targets node22-macos-arm64,node22-macos-x64',
      '--out-path binaries',
      '--compress GZip',
      '--no-bytecode',
      '--public-packages "*"',
    ].join(' '),
    { cwd: root, stdio: 'inherit' },
  );

  // Rename outputs to known names
  const renames = [
    ['index-macos-arm64', 'fcc-macos-arm64'],
    ['index-macos-x64', 'fcc-macos-x64'],
    // fallback names pkg sometimes uses
    ['fcc-macos-arm64', 'fcc-macos-arm64'],
    ['fcc-macos-x64', 'fcc-macos-x64'],
  ];

  for (const [src, dst] of renames) {
    const srcPath = path.join(root, 'binaries', src);
    const dstPath = path.join(root, 'binaries', dst);
    if (existsSync(srcPath) && src !== dst) {
      execSync(`mv ${JSON.stringify(srcPath)} ${JSON.stringify(dstPath)}`);
    }
  }

  execSync('chmod +x binaries/fcc-macos-arm64 binaries/fcc-macos-x64', {
    cwd: root,
  });

  console.log('\nBinaries built:');
  execSync('ls -lh binaries/', { cwd: root, stdio: 'inherit' });
  console.log('\nSHA256:');
  execSync('shasum -a 256 binaries/fcc-macos-arm64 binaries/fcc-macos-x64', {
    cwd: root,
    stdio: 'inherit',
  });
} catch (err) {
  console.error('Build failed:', err.message);
  process.exit(1);
}
