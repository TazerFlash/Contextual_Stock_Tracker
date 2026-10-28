import { renderMemory } from "./memory";
import type { Prompt, RetrievedChunk, SharedMemory } from "./types";

export const ANSWER_STOP = ["###"];
const INSIGHT_MAX_WORDS = 15;

const ANSWER_SYSTEM = `You are a concise financial analyst on the user's phone. Answer from the filing excerpts and relate the answer to the investor's profile. Quote numbers exactly as written. Never invent numbers. If the excerpts don't answer the question, say so.`;

/**
 * FR-02: fuse Layer 1 (retrieved chunks) and Layer 2 (shared memory) with the user's query.
 * Excerpts come first and the question last, which a 0.5B model follows more reliably.
 */
export function buildAnswerPrompt(memory: SharedMemory, chunks: RetrievedChunk[], query: string): Prompt {
  const excerpts = chunks.length
    ? chunks.map((c, i) => `[${i + 1}] ${c.source.ticker} ${c.source.form}, filed ${c.source.filedAt}:\n${c.text}`).join("\n\n")
    : "(none found)";

  const user = `Question to answer: ${query}
Read all the excerpts below; the answer may be in any of them.

### FILING EXCERPTS
${excerpts}

### INVESTOR PROFILE
${renderMemory(memory)}

### QUESTION
${query}

Answer in three short lines:
Facts: <the specific figures or reasons from the excerpts that answer the question, with [n]>
Impact on you: <what that means for this investor's target price, sentiment or notes>
Bottom line: <one sentence>`;

  return { system: ANSWER_SYSTEM, user };
}

/** FR-04: ask for a one-sentence takeaway to write back into shared memory. */
export function buildInsightPrompt(query: string, answer: string): Prompt {
  return {
    system: `You write one-sentence memory notes for an investor's assistant. Output a single sentence of at most ${INSIGHT_MAX_WORDS} words and nothing else.`,
    user: `Question: ${query}\n\nAnswer: ${answer}\n\nWhat is the key takeaway worth remembering for this investor's future questions?`,
  };
}

/** Normalizes model output into a clean insight, or null if nothing usable came back. */
export function cleanInsight(raw: string): string | null {
  const firstLine = raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const stripped = firstLine
    .replace(/^(insight|takeaway|note|key takeaway)\s*:\s*/i, "")
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/^["'“]+|["'”]+$/g, "")
    .trim();
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;
  let text = words.slice(0, INSIGHT_MAX_WORDS).join(" ");
  if (!/[.!?]$/.test(text)) text = text.replace(/[,;:]$/, "") + ".";
  return text;
}
