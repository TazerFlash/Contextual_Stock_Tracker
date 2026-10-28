import type { Insight, KeyValueStorage, SharedMemory } from "./types";

export const MEMORY_TOKEN_BUDGET = 1000;
const MAX_INSIGHTS = 10;
const STORAGE_KEY = "shared_memory";

export const DEFAULT_MEMORY: SharedMemory = {
  userId: "usr_alpha_01",
  watchlist: ["AAPL", "MSFT", "NVDA"],
  targetPrices: { NVDA: 1200, MSFT: 480 },
  portfolioNotes: "Looking to trim AAPL if revenue guidance drops post-earnings.",
  recentSentiment: { MSFT: "Strong Buy", NVDA: "Neutral/Overbought" },
  insights: [],
};

/** Rough token count (~4 chars/token for English); good enough for a budget guard. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * The Layer 2 block exactly as it is injected into the prompt. One line per ticker, so a small
 * model can't attach one stock's target price to another.
 */
export function renderMemory(m: SharedMemory): string {
  const lines = ["Watchlist:"];
  for (const ticker of m.watchlist) {
    const details = [];
    if (m.targetPrices[ticker] !== undefined) details.push(`target price $${m.targetPrices[ticker]}`);
    if (m.recentSentiment[ticker]) details.push(`sentiment ${m.recentSentiment[ticker]}`);
    lines.push(`- ${ticker}${details.length ? `: ${details.join("; ")}` : ""}`);
  }
  if (!m.watchlist.length) lines.push("- (empty)");
  if (m.portfolioNotes) lines.push(`Notes: ${m.portfolioNotes}`);
  if (m.insights.length) {
    lines.push("Learned insights:", ...m.insights.map((i) => `- ${i.text}`));
  }
  return lines.join("\n");
}

/**
 * Narrows the profile to the tickers a question is about (all of it if the question names none).
 * Notes that only name other stocks are left out, so "trim AAPL" doesn't color an NVDA answer.
 */
export function focusMemory(m: SharedMemory, tickers: string[]): SharedMemory {
  const focus = m.watchlist.filter((t) => tickers.includes(t));
  if (!focus.length) return m;
  const named = m.watchlist.filter((t) => new RegExp(`\\b${t}\\b`).test(m.portfolioNotes));
  const notesApply = !named.length || named.some((t) => focus.includes(t));
  return { ...m, watchlist: focus, portfolioNotes: notesApply ? m.portfolioNotes : "" };
}

/** Drop the oldest insights, then truncate notes, until the rendered memory fits the budget. */
export function fitToBudget(m: SharedMemory, maxTokens = MEMORY_TOKEN_BUDGET): SharedMemory {
  const out: SharedMemory = { ...m, insights: m.insights.slice(-MAX_INSIGHTS) };
  while (estimateTokens(renderMemory(out)) > maxTokens && out.insights.length) {
    out.insights = out.insights.slice(1);
  }
  const overChars = (estimateTokens(renderMemory(out)) - maxTokens) * 4;
  if (overChars > 0) {
    out.portfolioNotes = out.portfolioNotes.slice(0, Math.max(0, out.portfolioNotes.length - overChars - 1)) + "…";
  }
  return out;
}

/** Deep copy via JSON (structuredClone isn't available in every React Native JS engine). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export class MemoryStore {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly key = STORAGE_KEY,
  ) {}

  /** Loads memory, seeding (and persisting) the default profile on first run. */
  async load(): Promise<SharedMemory> {
    const raw = await this.storage.getItem(this.key);
    if (!raw) {
      await this.save(DEFAULT_MEMORY);
      return clone(DEFAULT_MEMORY);
    }
    const parsed = JSON.parse(raw) as Partial<SharedMemory>;
    return { ...clone(DEFAULT_MEMORY), ...parsed, insights: parsed.insights ?? [] };
  }

  async save(m: SharedMemory): Promise<void> {
    await this.storage.setItem(this.key, JSON.stringify(fitToBudget(m), null, 2));
  }

  /** FR-04: append a learned insight (deduplicated), keeping the budget. Returns the saved memory. */
  async addInsight(text: string, now = new Date()): Promise<SharedMemory> {
    const m = await this.load();
    const exists = m.insights.some((i) => i.text.toLowerCase() === text.toLowerCase());
    if (!exists) {
      const insight: Insight = { text, createdAt: now.toISOString() };
      m.insights.push(insight);
    }
    const fitted = fitToBudget(m);
    await this.storage.setItem(this.key, JSON.stringify(fitted, null, 2));
    return fitted;
  }
}
