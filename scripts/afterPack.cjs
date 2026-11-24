// electron-builder hook. electron-builder leaves every *.d.ts out of the
// packaged node_modules, but TypeScript 7's native `tsc` (the bundled language
// server, see src/main/lsp/serverRegistry.ts) refuses to start without the
// lib*.d.ts files beside its binary. Copy them into app.asar.unpacked, where
// `asarUnpack` put the binary.
const fs = require('fs');
const path = require('path');
const { Arch } = require('builder-util');

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName === 'mas' ? 'darwin' : context.electronPlatformName;
  const pkg = `@typescript/typescript-${platform}-${Arch[context.arch]}`;
  const typescriptDir = path.dirname(require.resolve('typescript7/package.json'));
  const src = path.join(
    path.dirname(require.resolve(`${pkg}/package.json`, { paths: [typescriptDir] })),
    'lib',
  );
  const resources =
    platform === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : path.join(context.appOutDir, 'resources');
  const dest = path.join(resources, 'app.asar.unpacked', 'node_modules', pkg, 'lib');
  if (!fs.existsSync(dest)) throw new Error(`afterPack: ${dest} is missing (check asarUnpack)`);
  const libs = fs.readdirSync(src).filter((f) => f.endsWith('.d.ts'));
  for (const file of libs) fs.copyFileSync(path.join(src, file), path.join(dest, file));
  console.log(`  • afterPack: copied ${libs.length} TypeScript lib files into ${pkg}`);
};
