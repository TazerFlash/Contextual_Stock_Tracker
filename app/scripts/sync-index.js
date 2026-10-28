// Copies the search index built by the desktop pipeline (../data/index) into the Android app's assets,
// so it ships inside the APK. Run after `npm run index` in the project root.
const fs = require('fs');
const path = require('path');

const from = path.resolve(__dirname, '../../data/index');
const to = path.resolve(__dirname, '../android/app/src/main/assets/index');

fs.mkdirSync(to, { recursive: true });
for (const file of ['index.json', 'vectors.f32']) {
  const source = path.join(from, file);
  if (!fs.existsSync(source)) {
    console.error(`Missing ${source}. Build the index first: npm run fetch && npm run index (in the project root).`);
    process.exit(1);
  }
  fs.copyFileSync(source, path.join(to, file));
  console.log(`${file}: ${(fs.statSync(source).size / 1e6).toFixed(1)} MB -> ${path.relative(process.cwd(), to)}`);
}
