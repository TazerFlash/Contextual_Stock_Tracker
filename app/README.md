# Contextual Stock Tracker: Android app

The on-device copilot as a React Native app. It runs the shared engine in [`../src/core`](../src/core) with [llama.rn](https://github.com/mybigday/llama.rn): search, generation and your profile all stay on the phone.

## Screens
- **Setup.** On first launch it downloads the two model files once (528 MB: Qwen2.5-0.5B-Instruct and bge-small), with progress. After that the app works offline.
- **Ask.** Type a question or tap a suggestion. The answer streams in, followed by the filing passages it used (tap to expand) and timings. Tap 👍 to save a one-sentence takeaway to your profile.
- **Profile.** Edit your watchlist, target prices, sentiment and notes, and review or remove saved takeaways. It shows the profile's token budget.

## How it fits together

| File | Role |
|---|---|
| `src/engine.ts` | llama.rn implementation of the engine interface (chat + embeddings) |
| `src/models.ts` | Model download and presence checks, in the app's private storage |
| `src/loadIndex.ts` | Loads the bundled search index from APK assets |
| `src/storage.ts` | Profile storage (JSON file) |
| `src/ui/` | Setup, Ask and Profile screens |
| `scripts/sync-index.js` | Copies `../data/index` (built by the desktop pipeline) into the APK assets |
| `scripts/patch-llama-rn.js` | Runs after `npm install`; makes x86_64 emulators load llama.rn's optimized x86_64 library, built with AVX2 |

## Build and run (Android)

Requires the Android SDK/NDK and JDK 17. First build the search index in the project root (`npm run fetch && npm run index`), then:

```bash
npm install
npm run sync-index                 # copy the index into the app's assets
npm run build:emulator             # x86_64 emulator build, llama.rn compiled from source with AVX2
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
npx react-native start
```

For a physical ARM phone, `npm run android` uses llama.rn's prebuilt ARM libraries.

**Skip the in-app download during development** by copying models from the desktop `models/` folder into the app's private storage (debug builds only):

```bash
adb push ../models/hf_Qwen_qwen2.5-0.5b-instruct-q4_k_m.gguf /data/local/tmp/qwen2.5-0.5b-instruct-q4_k_m.gguf
adb push ../models/hf_CompendiumLabs_bge-small-en-v1.5-q8_0.gguf /data/local/tmp/bge-small-en-v1.5-q8_0.gguf
adb shell "run-as com.stocktracker sh -c 'mkdir -p files/models && cp /data/local/tmp/*.gguf files/models/'"
```

**Windows:** the C++ build fails if paths exceed 260 characters. Build from a short path, either by moving the project (e.g. `C:\dev\cst`) or by mapping a drive with `subst T: "<path>\app"` and building from `T:\`.

## Status
- **Working on the Pixel 8 Pro emulator:** the app installs, loads the models and index, and answers repeated questions correctly, citing sources.
- **Emulator speed:** with `scripts/patch-llama-rn.js`, llama.rn uses its AVX2 x86_64 library. Generation went from 3.4 to 9.8 tokens/s and a full answer from ~162 s to ~40 s. Prompt processing (~18 tokens/s) still dominates time to first word (~17–21 s).
- **Next:** measure on a real ARM phone, where the latency targets apply.

Details are in [`../IMPLEMENTATION_LOG.md`](../IMPLEMENTATION_LOG.md), Part 2 §10.
