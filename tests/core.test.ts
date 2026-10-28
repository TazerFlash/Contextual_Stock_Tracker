import { describe, expect, it } from "vitest";
import { chunkText } from "../src/core/chunker";
import { asksForRecent, Copilot } from "../src/core/copilot";
import { DEFAULT_MEMORY, estimateTokens, fitToBudget, focusMemory, MemoryStore, renderMemory } from "../src/core/memory";
import { buildAnswerPrompt, cleanInsight } from "../src/core/promptBuilder";
import type { GenerateOptions, KeyValueStorage, LlmEngine, Prompt, VectorIndex } from "../src/core/types";
import { createIndex, mentionedTickers, stripCompanyMentions, VectorStore } from "../src/core/vectorStore";
import { htmlToText, removeRepeatedLines } from "../src/ingest/htmlToText";

class MemStorage implements KeyValueStorage {
  data = new Map<string, string>();
  async getItem(k: string) { return this.data.get(k) ?? null; }
  async setItem(k: string, v: string) { this.data.set(k, v); }
}

const src = (ticker: string, company: string) => ({ ticker, company, form: "10-K", filedAt: "2026-01-30", url: "u" });
const META = { embeddingModel: "test", createdAt: "" };
const ITEMS = [
  { text: "Data center revenue grew strongly.", source: src("NVDA", "NVIDIA CORP"), vector: [1, 0, 0] },
  { text: "iPhone sales declined.", source: src("AAPL", "Apple Inc."), vector: [0, 1, 0] },
  { text: "Azure cloud growth.", source: src("MSFT", "MICROSOFT CORP"), vector: [0.7, 0.7, 0] },
];
const INDEX: VectorIndex = createIndex(META, ITEMS);

describe("chunkText", () => {
  it("respects size and overlaps neighbouring chunks", () => {
    const text = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} talks about revenue.`).join(" ");
    const chunks = chunkText(text, { chunkSize: 200, chunkOverlap: 50 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
    // The start of each chunk should appear at the end of the previous one.
    expect(chunks[0]).toContain(chunks[1].slice(0, 20));
    // Nothing lost: every sentence appears somewhere.
    for (let i = 0; i < 120; i++) expect(chunks.some((c) => c.includes(`number ${i} `))).toBe(true);
  });

  it("prefers paragraph breaks", () => {
    const chunks = chunkText("A".repeat(80) + "\n\n" + "B".repeat(80), { chunkSize: 100, chunkOverlap: 10 });
    expect(chunks).toEqual(["A".repeat(80), "B".repeat(80)]);
  });

  it("hard-splits a single oversized word", () => {
    const chunks = chunkText("x".repeat(250), { chunkSize: 100, chunkOverlap: 0 });
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
  });
});

describe("VectorStore", () => {
  const store = new VectorStore(INDEX);

  it("ranks by cosine similarity", () => {
    expect(store.search([2, 0.1, 0], 2).map((r) => r.id)).toEqual([0, 2]);
  });

  it("skips near-duplicate chunks", () => {
    const dup = new VectorStore(
      createIndex(META, [...ITEMS, { text: "Data center revenue grew strongly.", source: src("NVDA", "NVIDIA CORP"), vector: [0.99, 0.01, 0] }]),
    );
    expect(dup.search([1, 0, 0], 2).map((r) => r.id)).toEqual([0, 2]);
  });

  it("hybrid search lifts exact keyword matches above vague vector matches", () => {
    const hybrid = new VectorStore(
      createIndex(META, [
        { text: "Notes to the consolidated financial statements.", source: src("NVDA", "NVIDIA CORP"), vector: [1, 0, 0] },
        { text: "Revenue recognition policies and customer advances.", source: src("NVDA", "NVIDIA CORP"), vector: [0.9, 0.3, 0] },
        { text: "Gross margin increased to 75.0% on improved mix.", source: src("NVDA", "NVIDIA CORP"), vector: [0.5, 0.5, 0.5] },
      ]),
    );
    expect(hybrid.search([1, 0, 0], 1)[0].id).toBe(0); // vector only
    expect(hybrid.search([1, 0, 0], 1, {}, "What was NVIDIA's gross margin?")[0].id).toBe(2);
  });

  it("restricts to each company's newest filing when asked", () => {
    const dated = new VectorStore(
      createIndex(META, [
        { text: "Old annual figure.", source: { ...src("NVDA", "NVIDIA CORP"), filedAt: "2026-02-25" }, vector: [1, 0, 0] },
        { text: "New quarterly figure.", source: { ...src("NVDA", "NVIDIA CORP"), filedAt: "2026-08-26" }, vector: [0.8, 0.6, 0] },
        { text: "Apple quarter.", source: { ...src("AAPL", "Apple Inc."), filedAt: "2026-07-31" }, vector: [0.9, 0.1, 0] },
      ]),
    );
    expect(dated.search([1, 0, 0], 1)[0].id).toBe(0);
    expect(dated.search([1, 0, 0], 3, { latestOnly: true }).map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it("detects time-scoped questions", () => {
    expect(asksForRecent("How fast did revenue grow last quarter?")).toBe(true);
    expect(asksForRecent("What are the latest results?")).toBe(true);
    expect(asksForRecent("What export control risks does NVIDIA face?")).toBe(false);
    expect(asksForRecent("Why did iPhone sales increase last year?")).toBe(false);
  });

  it("strips company mentions the ticker filter already covers", () => {
    expect(stripCompanyMentions("What was NVIDIA's gross margin?", store.companies)).toBe("What was gross margin?");
    expect(stripCompanyMentions("Is Azure growing vs my MSFT target?", store.companies)).toBe("Is Azure growing vs my target?");
    expect(stripCompanyMentions("NVDA", store.companies)).toBe("NVDA"); // nothing left: keep the original
  });

  it("filters by ticker", () => {
    expect(store.search([1, 0, 0], 3, { tickers: ["AAPL"] }).map((r) => r.id)).toEqual([1]);
  });

  it("packs normalized vectors into one flat buffer", () => {
    expect(INDEX.vectors).toBeInstanceOf(Float32Array);
    expect(INDEX.vectors.length).toBe(9);
    expect(INDEX.vectors[6]).toBeCloseTo(Math.SQRT1_2); // [0.7, 0.7, 0] normalized
    expect(() => createIndex(META, [ITEMS[0], { ...ITEMS[1], vector: [1, 0] }])).toThrow(/dim/);
  });

  it("rejects mismatched dimensions", () => {
    expect(() => store.search([1, 0], 1)).toThrow(/dim/);
  });

  it("detects tickers and company names in a query", () => {
    expect(mentionedTickers("How is nvidia doing vs MSFT?", store.companies).sort()).toEqual(["MSFT", "NVDA"]);
    expect(mentionedTickers("what about apple guidance", store.companies)).toEqual(["AAPL"]);
    expect(mentionedTickers("general market outlook", store.companies)).toEqual([]);
  });
});

describe("shared memory", () => {
  it("seeds defaults on first load and persists them", async () => {
    const storage = new MemStorage();
    const m = await new MemoryStore(storage).load();
    expect(m.watchlist).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(storage.data.has("shared_memory")).toBe(true);
  });

  it("adds deduplicated insights", async () => {
    const store = new MemoryStore(new MemStorage());
    await store.addInsight("NVDA margin pressure matters for my target.");
    const m = await store.addInsight("nvda margin pressure matters for my target.");
    expect(m.insights).toHaveLength(1);
  });

  it("focuses the profile on the tickers a question names", () => {
    expect(focusMemory(DEFAULT_MEMORY, ["MSFT"]).watchlist).toEqual(["MSFT"]);
    expect(focusMemory(DEFAULT_MEMORY, []).watchlist).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(renderMemory(focusMemory(DEFAULT_MEMORY, ["MSFT"]))).not.toContain("1200");
  });

  it("drops notes about other stocks when focused", () => {
    expect(focusMemory(DEFAULT_MEMORY, ["NVDA"]).portfolioNotes).toBe(""); // note is about AAPL
    expect(focusMemory(DEFAULT_MEMORY, ["AAPL"]).portfolioNotes).toContain("trim AAPL");
    expect(focusMemory({ ...DEFAULT_MEMORY, portfolioNotes: "Keep 10% cash." }, ["NVDA"]).portfolioNotes).toBe("Keep 10% cash.");
  });

  it("keeps rendered memory within the token budget", () => {
    const big = {
      ...DEFAULT_MEMORY,
      portfolioNotes: "note ".repeat(2000),
      insights: Array.from({ length: 10 }, (_, i) => ({ text: `insight ${i} `.repeat(10), createdAt: "" })),
    };
    const fitted = fitToBudget(big, 300);
    expect(estimateTokens(renderMemory(fitted))).toBeLessThanOrEqual(300);
    expect(fitted.insights).toHaveLength(0);
  });
});

describe("prompts", () => {
  it("fuses both memory layers and the query", () => {
    const store = new VectorStore(INDEX);
    const p = buildAnswerPrompt(DEFAULT_MEMORY, store.search([1, 0, 0], 1), "Should I worry about NVDA?");
    expect(p.user).toContain("- NVDA: target price $1200; sentiment Neutral/Overbought");
    expect(p.user).toContain("[1] NVDA 10-K");
    expect(p.user).toContain("Data center revenue");
    expect(p.user).toContain("Should I worry about NVDA?");
  });

  it("cleans insights to one short sentence", () => {
    expect(cleanInsight('Insight: "NVDA trades above fair value versus your $1200 target"\nmore')).toBe(
      "NVDA trades above fair value versus your $1200 target.",
    );
    expect(cleanInsight("ok")).toBeNull();
    expect(cleanInsight("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen"))
      .toBe("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen.");
  });
});

describe("Copilot", () => {
  class FakeEngine implements LlmEngine {
    prompts: Prompt[] = [];
    async embed(text: string) { return /apple/i.test(text) ? [0, 1, 0] : [1, 0, 0]; }
    async generate(prompt: Prompt, o: GenerateOptions) {
      this.prompts.push(prompt);
      o.onToken?.("Facts: ");
      return prompt.system.includes("memory notes") ? "Apple guidance cut would trigger the user's AAPL trim plan." : "Facts: x";
    }
  }

  it("answers from retrieved chunks and learns on positive feedback", async () => {
    const engine = new FakeEngine();
    const memory = new MemoryStore(new MemStorage());
    const copilot = new Copilot(engine, new VectorStore(INDEX), memory, { topK: 2 });

    const r = await copilot.ask("What did Apple say about iPhone?");
    expect(r.sources.map((s) => s.source.ticker)).toEqual(["AAPL"]); // narrowed to the mentioned company
    expect(r.timings.firstTokenMs).not.toBeNull();

    const insight = await copilot.learn("q", r.answer);
    expect(insight).toBe("Apple guidance cut would trigger the user's AAPL trim plan.");
    expect((await memory.load()).insights[0].text).toBe(insight);

    await copilot.ask("Any risks?");
    expect(engine.prompts.at(-1)!.user).toContain(`- ${insight}`); // insight flows into the next prompt
  });
});

describe("removeRepeatedLines", () => {
  it("drops running headers but keeps prose and paragraph breaks", () => {
    const page = "Table of Contents\nRevenue grew this quarter on strong demand.\n\n";
    const text = Array.from({ length: 6 }, (_, i) => page.replace("this quarter", `in quarter ${i}`)).join("");
    const out = removeRepeatedLines(text);
    expect(out).not.toContain("Table of Contents");
    expect(out).toContain("Revenue grew in quarter 5 on strong demand.");
    expect(out).toContain("\n\n");
  });
});

describe("htmlToText", () => {
  it("strips XBRL header, tags, entities and numeric noise", () => {
    const html = `<html><head><title>x</title></head><body>
      <div style="display:none"><ix:header><ix:hidden>secret</ix:hidden></ix:header></div>
      <p>Revenue grew&#160;20%&nbsp;to $10 billion &amp; margins held.</p>
      <table><tr><td>Revenue</td><td>10,000</td></tr><tr><td>12</td><td>34</td></tr></table>
      <table><tr><td>•</td><td>Layout table holding a bullet of prose about supply chains.</td></tr></table>
      <p>NVIDIA&#8217;s outlook</p></body></html>`;
    const text = htmlToText(html);
    expect(text).not.toContain("secret");
    expect(text).toContain("Revenue grew 20% to $10 billion & margins held.");
    expect(text).not.toContain("10,000"); // numeric table dropped
    expect(text).toContain("Layout table holding a bullet of prose"); // prose table kept
    expect(text).toContain("NVIDIA’s outlook");
  });
});
