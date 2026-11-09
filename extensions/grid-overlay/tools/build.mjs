// Builds package/ui from src/ and the unchanged form.ext SDK in vendor/.
// The extension is plain ES modules, so the build copies the files as they are: what ships is the source, byte for
// byte. package/manifest.json is not touched.
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'package', 'ui');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copied = [];
for (const dir of ['src', 'vendor']) {
  for (const name of readdirSync(join(root, dir)).sort()) {
    const from = join(root, dir, name);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(out, name));
    copied.push(`${dir}/${name}`);
  }
}
console.log(`package/ui: ${copied.length} files (${copied.join(', ')})`);
