// Two patches to llama.rn 0.12.x for the x86_64 Android emulator. Runs on postinstall; safe to repeat.
//
// 1. Library selection: x86_64 emulator images also list arm64-v8a (ARM translation), and llama.rn
//    checks for ARM before x86_64 using *any* listed ABI. It then finds no ARM libraries in an x86_64
//    APK and falls back to the generic build with no SIMD at all (~4 tokens/s). Treat the device as ARM
//    only when arm64-v8a is its primary ABI, which is unchanged on real ARM phones.
// 2. CPU flags: the x86_64 library targets baseline x86-64 + SSE4.2. Switch it to x86-64-v3 (AVX2, FMA,
//    F16C). This only takes effect when llama.rn is built from source (`npm run build:emulator`); phone
//    (arm64) builds keep llama.rn's optimized prebuilt libraries. Needs an AVX2-capable host CPU.
const fs = require('fs');
const path = require('path');

const android = path.resolve(__dirname, '../node_modules/llama.rn/android/src/main');

const PATCHES = [
  {
    file: 'java/com/rnllama/RNLlama.java',
    name: 'primary-ABI check',
    from: `  private static boolean isArm64V8a() {
    for (String abi : Build.SUPPORTED_ABIS) {
      if ("arm64-v8a".equalsIgnoreCase(abi)) return true;
    }
    return false;
  }`,
    to: `  private static boolean isArm64V8a() {
    // Patched (app/scripts/patch-llama-rn.js): primary ABI only, so x86_64 emulators use the x86_64 library.
    return Build.SUPPORTED_ABIS.length > 0 && "arm64-v8a".equalsIgnoreCase(Build.SUPPORTED_ABIS[0]);
  }`,
  },
  ...['CMakeLists.txt', 'rnllama/CMakeLists.txt'].map((file) => ({
    file,
    name: 'x86_64 AVX2 flags',
    from: '"-march=x86-64;-mtune=generic;-msse4.2;-mpopcnt"',
    to: '"-march=x86-64-v3;-mtune=generic"',
  })),
];

for (const { file, name, from, to } of PATCHES) {
  const target = path.join(android, file);
  if (!fs.existsSync(target)) {
    console.warn(`patch-llama-rn: ${file} not found, skipping ${name}`);
    continue;
  }
  const source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (source.includes(to)) {
    console.log(`patch-llama-rn: ${file}: ${name} already applied`);
  } else if (source.includes(from)) {
    fs.writeFileSync(target, source.replace(from, to));
    console.log(`patch-llama-rn: ${file}: applied ${name}`);
  } else {
    console.warn(`patch-llama-rn: ${file}: ${name} not applied, code changed upstream; review this patch`);
  }
}
