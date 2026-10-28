// Fixed question set for before/after comparisons.
// Usage: npm run eval -- <label>                    full run, writes data/eval/<label>.json
//        npm run eval -- <label> --retrieval-only   retrieval hit@3 only (no generation, seconds)
//        npm run eval -- <label> --repeat 3         ask each question 3 times (less noise)
import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { MODELS } from "../src/config";
import { Copilot } from "../src/core/copilot";
import { focusMemory, MemoryStore } from "../src/core/memory";
import { buildAnswerPrompt } from "../src/core/promptBuilder";
import type { KeyValueStorage } from "../src/core/types";
import { mentionedTickers, VectorStore } from "../src/core/vectorStore";
import { loadIndex } from "../src/desktop/loadIndex";
import { NodeLlamaEngine } from "../src/desktop/nodeLlamaEngine";

interface EvalCase {
  question: string;
  ticker: string;
  /** Matches the passage in the filings that answers the question; it should be retrieved. */
  evidence: RegExp;
  /** Facts from the filings; the answer should contain at least one. */
  facts: string[];
  /** Signs the answer used the user's profile (targets, sentiment, notes). */
  personal: string[];
}

const CASES: EvalCase[] = [
  { question: "How fast did NVIDIA's Data Center revenue grow last quarter?", ticker: "NVDA", evidence: /Data Center revenue was \$89/, facts: ["89", "117"], personal: ["1200", "1,200", "overbought"] },
  { question: "Is Azure still growing, and how does that fit my MSFT target?", ticker: "MSFT", evidence: /Azure and other cloud services revenue grew/, facts: ["40%", "41%", "40 percent"], personal: ["480", "strong buy"] },
  { question: "Why did Apple's iPhone sales increase?", ticker: "AAPL", evidence: /iPhone net sales increased/, facts: ["pro model", "pro"], personal: ["trim"] },
  { question: "Did Apple's iPhone revenue grow, and does that affect my plan to trim AAPL?", ticker: "AAPL", evidence: /iPhone net sales increased/, facts: ["increase", "grew", "higher", "pro"], personal: ["trim"] },
  { question: "What export control risks does NVIDIA face in China?", ticker: "NVDA", evidence: /export control/i, facts: ["h200", "license", "export"], personal: ["1200", "1,200", "overbought"] },
  { question: "What was NVIDIA's gross margin?", ticker: "NVDA", evidence: /Gross margin increased to 75/, facts: ["75"], personal: ["1200", "1,200", "overbought"] },
];

function privateMemoryMb(): number | null {
  if (process.platform !== "win32") return null;
  try {
    const bytes = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${process.pid}).PrivateMemorySize64"`);
    return Math.round(Number(bytes.toString().trim()) / 1e6);
  } catch {
    return null;
  }
}

class MemStorage implements KeyValueStorage {
  private data = new Map<string, string>();
  async getItem(k: string) { return this.data.get(k) ?? null; }
  async setItem(k: string, v: string) { this.data.set(k, v); }
}

const label = process.argv[2] ?? "run";
const retrievalOnly = process.argv.includes("--retrieval-only");
const repeatArg = process.argv.indexOf("--repeat");
const repeats = repeatArg > 0 ? Number(process.argv[repeatArg + 1]) : 1;
const store = new VectorStore(await loadIndex());
const memory = new MemoryStore(new MemStorage()); // default profile, no learned insights: reproducible

if (retrievalOnly) {
  const engine = await NodeLlamaEngine.create();
  const copilot = new Copilot(engine, store, memory);
  let hits = 0;
  for (const c of CASES) {
    const { sources: all } = await copilot.retrieve(c.question, store.size);
    const rank = all.findIndex((r) => c.evidence.test(r.text)) + 1;
    if (rank >= 1 && rank <= 3) hits++;
    console.log(`${rank >= 1 && rank <= 3 ? "✓" : "✗"} rank ${rank || "-"}  ${c.question}`);
  }
  console.log(`\nRETRIEVAL hit@3: ${hits}/${CASES.length}`);
  await engine.dispose();
  process.exit(0);
}

const engine = await NodeLlamaEngine.create({ withChat: true });
const copilot = new Copilot(engine, store, memory);

const results = [];
let peakRssMb = 0;
// With --repeat N every question is asked N times; sampling makes single runs noisy (±1 of 6).
for (const [i, c] of CASES.flatMap((c) => Array<EvalCase>(repeats).fill(c)).entries()) {
  const r = await copilot.ask(c.question);
  const focused = focusMemory(await memory.load(), mentionedTickers(c.question, store.companies));
  const prompt = buildAnswerPrompt(focused, r.sources, c.question);
  const lower = r.answer.toLowerCase();
  const result = {
    question: c.question,
    /** Repeats after the first reuse llama.cpp's cached prompt, so only run 0 has a real first-token time. */
    run: i % repeats,
    answer: r.answer,
    sources: r.sources.map((s) => `${s.source.ticker} ${s.source.form} ${s.score.toFixed(3)}`),
    promptTokens: engine.countTokens(prompt.system + prompt.user),
    firstTokenMs: Math.round(r.timings.firstTokenMs ?? -1),
    totalMs: Math.round(r.timings.totalMs),
    rightCompany: r.sources.every((s) => s.source.ticker === c.ticker),
    retrievalHit: r.sources.some((s) => c.evidence.test(s.text)),
    factHit: c.facts.some((f) => lower.includes(f)),
    personalHit: c.personal.some((p) => lower.includes(p)),
  };
  results.push(result);
  peakRssMb = Math.max(peakRssMb, Math.round(process.memoryUsage().rss / 1e6));
  console.log(`\n### ${c.question}\n${r.answer}\n-> fact ${result.factHit ? "✓" : "✗"} · personal ${result.personalHit ? "✓" : "✗"} · ${result.promptTokens} prompt tok · first token ${result.firstTokenMs}ms · total ${result.totalMs}ms`);
}
await engine.dispose();

const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
const summary = {
  label,
  chatModel: MODELS.chat,
  questions: results.length,
  retrievalHits: results.filter((r) => r.retrievalHit).length,
  factHits: results.filter((r) => r.factHit).length,
  personalHits: results.filter((r) => r.personalHit).length,
  rightCompany: results.filter((r) => r.rightCompany).length,
  avgPromptTokens: avg(results.map((r) => r.promptTokens)),
  avgFirstTokenMs: avg(results.filter((r) => r.run === 0).map((r) => r.firstTokenMs)),
  avgTotalMs: avg(results.filter((r) => r.run === 0).map((r) => r.totalMs)),
  /** Working set: includes memory-mapped model pages, which the OS can drop and re-read from disk. */
  peakRssMb,
  /** Memory only this process owns (Windows private bytes): KV cache, compute buffers, JS heap. This is the RAM KPI (≤ 600 MB). */
  privateMb: privateMemoryMb(),
};
await mkdir("data/eval", { recursive: true });
await writeFile(`data/eval/${label}.json`, JSON.stringify({ summary, results }, null, 2), "utf8");
console.log("\nSUMMARY", JSON.stringify(summary));
