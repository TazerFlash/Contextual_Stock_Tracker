import { focusMemory, MemoryStore } from "./memory";
import { ANSWER_STOP, buildAnswerPrompt, buildInsightPrompt, cleanInsight } from "./promptBuilder";
import type { LlmEngine, RetrievedChunk } from "./types";
import { mentionedTickers, stripCompanyMentions, VectorStore } from "./vectorStore";

export interface CopilotOptions {
  topK?: number;
  maxTokens?: number;
  temperature?: number;
}

export interface AskResult {
  answer: string;
  sources: RetrievedChunk[];
  timings: {
    embedMs: number;
    retrieveMs: number;
    /** Time from starting generation to the first streamed token (KPI: <= 2.0 s). */
    firstTokenMs: number | null;
    generateMs: number;
    totalMs: number;
  };
}

/** True for questions about the latest period ("last quarter", "latest results", "recently"). */
export function asksForRecent(query: string): boolean {
  return /\b(last|latest|this|current|most recent|recent)\s+(quarter|qtr|period|results?|earnings|filing)\b|\b(latest|recently|lately)\b/i.test(query);
}

/** Orchestrates the dual-memory flow: embed -> retrieve (Layer 1) + load memory (Layer 2) -> fuse -> generate. */
export class Copilot {
  constructor(
    private readonly engine: LlmEngine,
    private readonly store: VectorStore,
    private readonly memory: MemoryStore,
    private readonly options: CopilotOptions = {},
  ) {}

  /** Layer 1 retrieval for a question: the top-k chunks plus the tickers it names. */
  async retrieve(query: string, k = this.options.topK ?? 3) {
    const t0 = performance.now();
    // Narrow to the companies the question names, then search on the rest of the question.
    const tickers = mentionedTickers(query, this.store.companies);
    const searchText = tickers.length ? stripCompanyMentions(query, this.store.companies) : query;
    const queryVector = await this.engine.embed(searchText, "query");
    const t1 = performance.now();

    // Time-scoped questions search the newest filing first; each filter is dropped if it finds nothing.
    const attempts = [
      ...(asksForRecent(query) ? [{ tickers, latestOnly: true }] : []),
      { tickers },
      {},
    ];
    let sources: RetrievedChunk[] = [];
    for (const filter of attempts) {
      sources = this.store.search(queryVector, k, filter, searchText);
      if (sources.length) break;
    }
    return { sources, tickers, embedMs: t1 - t0, searchMs: performance.now() - t1 };
  }

  async ask(query: string, onToken?: (text: string) => void): Promise<AskResult> {
    const t0 = performance.now();
    const { sources, tickers, embedMs } = await this.retrieve(query);
    // Only show the profile for the companies asked about: shorter prompt, fewer mix-ups.
    const memory = focusMemory(await this.memory.load(), tickers);
    const t1 = t0 + embedMs;
    const t2 = performance.now();

    let firstToken: number | null = null;
    const answer = await this.engine.generate(buildAnswerPrompt(memory, sources, query), {
      maxTokens: this.options.maxTokens ?? 200,
      temperature: this.options.temperature ?? 0.2,
      repeatPenalty: 1.1,
      stop: ANSWER_STOP,
      onToken: (text) => {
        firstToken ??= performance.now();
        onToken?.(text);
      },
    });
    const t3 = performance.now();

    return {
      answer: answer.trim(),
      sources,
      timings: {
        embedMs: t1 - t0,
        retrieveMs: t2 - t1,
        firstTokenMs: firstToken === null ? null : firstToken - t2,
        generateMs: t3 - t2,
        totalMs: t3 - t0,
      },
    };
  }

  /** FR-04 memory loop: on positive feedback, distill a <=15-word insight and persist it. */
  async learn(query: string, answer: string): Promise<string | null> {
    const raw = await this.engine.generate(buildInsightPrompt(query, answer), {
      maxTokens: 40,
      temperature: 0.2,
      stop: ["\n\n"],
    });
    const insight = cleanInsight(raw);
    if (insight) await this.memory.addInsight(insight);
    return insight;
  }
}
