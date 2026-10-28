// Interactive copilot in the terminal. `npm run ask` for a REPL, or `npm run ask -- "question"` for one shot.
// REPL commands: /memory (show Layer 2), /quit
import { createInterface } from "node:readline/promises";
import { PATHS } from "../src/config";
import { Copilot, type AskResult } from "../src/core/copilot";
import { MemoryStore, renderMemory } from "../src/core/memory";
import type { VectorIndex } from "../src/core/types";
import { VectorStore } from "../src/core/vectorStore";
import { FileStorage } from "../src/desktop/fileStorage";
import { loadIndex } from "../src/desktop/loadIndex";
import { NodeLlamaEngine } from "../src/desktop/nodeLlamaEngine";

let index: VectorIndex;
try {
  index = await loadIndex();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const storage = new FileStorage(PATHS.state);
const memory = new MemoryStore(storage);
await memory.load(); // seeds the default profile on first run

const loadStart = performance.now();
const engine = await NodeLlamaEngine.create({ withChat: true });
console.log(`Models loaded in ${((performance.now() - loadStart) / 1000).toFixed(2)}s (KPI: <= 3.5s) · ${index.chunks.length} chunks indexed`);
console.log(`Edit your profile in ${storage.path("shared_memory")}`);

const copilot = new Copilot(engine, new VectorStore(index), memory);

function report(r: AskResult) {
  console.log("\n\nSources:");
  r.sources.forEach((s, i) =>
    console.log(`  [${i + 1}] ${s.source.ticker} ${s.source.form} filed ${s.source.filedAt}  (score ${s.score.toFixed(3)})`),
  );
  const t = r.timings;
  const first = t.firstTokenMs === null ? "n/a" : `${(t.firstTokenMs / 1000).toFixed(2)}s`;
  console.log(
    `Timing: embed ${t.embedMs.toFixed(0)}ms · retrieve ${t.retrieveMs.toFixed(0)}ms · first token ${first} (KPI: <= 2.0s) · total ${(t.totalMs / 1000).toFixed(2)}s`,
  );
}

const oneShot = process.argv.slice(2).join(" ").trim();
if (oneShot) {
  process.stdout.write("\n");
  report(await copilot.ask(oneShot, (t) => process.stdout.write(t)));
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  while (true) {
    const query = (await rl.question("\nyou> ")).trim();
    if (!query) continue;
    if (query === "/quit") break;
    if (query === "/memory") {
      console.log(renderMemory(await memory.load()));
      continue;
    }
    process.stdout.write("\ncopilot> ");
    const result = await copilot.ask(query, (t) => process.stdout.write(t));
    report(result);
    if ((await rl.question("Helpful? [y/N] ")).trim().toLowerCase().startsWith("y")) {
      const insight = await copilot.learn(query, result.answer);
      console.log(insight ? `Remembered: ${insight}` : "(no usable insight produced)");
    }
  }
  rl.close();
}
await engine.dispose();
