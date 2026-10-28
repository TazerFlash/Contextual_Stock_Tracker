# Contextual Stock Tracker

An offline, on-device financial copilot. It answers questions about your watchlist by combining company filings with your own portfolio context. Everything runs locally: search, the language model and your profile never leave the device.

## Problem

Investors who use AI assistants for market research run into three problems:

1. **Privacy.** Cloud assistants need your holdings, target prices and investment notes sent to a third-party server. For many investors that's an unacceptable leak.
2. **Latency and connectivity.** Cloud round-trips for search and generation add seconds, and fail entirely on a weak connection.
3. **Generic answers.** Market tools summarize news in general. They don't answer *"what does this mean for **my** positions, **my** targets and **my** plans?"* Personal trackers, meanwhile, aren't grounded in authoritative company data.

## Solution: dual memory, on device

| Layer | What it holds | How it's used |
|---|---|---|
| **Layer 1: filings** | Latest 10-K and 10-Q for each watchlist stock, from SEC EDGAR, split into ~3,300 passages | Hybrid search finds the passages relevant to the question |
| **Layer 2: your profile** | Watchlist, target prices, sentiment, notes, and takeaways learned from your feedback (≤ 1,000 tokens) | Injected into the prompt, focused on the stocks the question names |

A small local model (Qwen2.5-0.5B-Instruct, 4-bit) combines both into a short answer: **Facts → Impact on you → Bottom line**, citing the passages it used. Mark an answer helpful and the copilot saves a one-sentence takeaway to your profile for future questions.

```
question ──► embed (bge-small) ──► hybrid search: vectors + BM25 keywords ──► top 3 passages ─┐
                                   (company filter, newest filing for "last quarter",          │
                                    near-duplicate removal)                                    ├─► prompt ─► Qwen2.5-0.5B ─► answer
your profile ──► focus on the stocks asked about ─────────────────────────────────────────────┘                        │
     ▲                                                                                                                  │
     └──────────────────────────── 👍 helpful → one-sentence takeaway saved ◄──────────────────────────────────────────┘
```

## What's built

### Engine (`src/core`, platform-independent TypeScript)
The same code runs on the desktop (with [node-llama-cpp](https://github.com/withcatai/node-llama-cpp)) and on the phone (with [llama.rn](https://github.com/mybigday/llama.rn)). Only a small engine adapter differs.

- **Ingestion.** SEC EDGAR download and HTML-to-text cleanup. It drops number-only tables (they lose their column headers when flattened) and repeated page headers.
- **Retrieval.** 500-character chunks; bge-small-en-v1.5 embeddings; hybrid ranking that fuses vector and BM25 keyword scores; a company filter that removes the company name from the search text once used; recency for time-scoped questions; near-duplicate removal.
- **Prompt and memory.** A per-ticker profile with only the stocks in question; notes about other stocks left out; a ≤ 1,000-token budget; the insight write-back loop.
- **Index format.** `index.json` (passages and sources) plus `vectors.f32` (raw Float32 embeddings), which load fast and stay small in memory.

### Evaluation (`scripts/eval.ts`)
A fixed set of questions with ground truth from the filings. It scores whether the right passage was retrieved, whether the answer contains the correct fact, and whether it uses the profile, plus latency and memory. It supports repeated runs (`--repeat`) and a fast retrieval-only mode.

### Android app (`app/`)
A React Native app on llama.rn:
- one-time model download screen
- Ask screen with streamed answers, tappable sources and timings
- Profile screen to edit the watchlist, targets, sentiment and notes, and to review saved takeaways

See [app/README.md](app/README.md).

## Results (desktop CPU, Intel i5-1035G1, 4 threads)

| Metric | Result | Target |
|---|---|---|
| Model load (chat + search) | 1.9–3.1 s | ≤ 3.5 s ✅ |
| Search (embed + hybrid retrieval) | ~20–30 ms | — |
| Time to first word | ~3.2–3.6 s | ≤ 2.0 s ❌ on this laptop CPU; to be measured on a phone |
| App-owned memory (excludes memory-mapped model files, ~530 MB) | ~256 MB | ≤ 600 MB ✅ |
| Right passage among the 3 sent to the model | 18/18 | — |
| Correct fact in the answer | ~10–11/18 | — |

Retrieval is reliable. The remaining accuracy limit is the 0.5B model: it tends to answer from the first passage even when the answer is in the second or third. The next step is a small re-ranking model so the best passage comes first. Full methodology, every experiment and its numbers are in [IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md).

## Run it (desktop)

Requires Node.js 20+.

```bash
npm install
npm run models                                              # ~530 MB: Qwen2.5-0.5B-Instruct Q4_K_M + bge-small (CHAT_MODEL=1.5b for the larger model)
SEC_USER_AGENT="Your Name you@example.com" npm run fetch    # latest 10-K + 10-Q for AAPL, MSFT, NVDA
npm run index                                               # chunk + embed -> data/index/index.json + vectors.f32
npm run ask                                                 # interactive; or: npm run ask -- "your question"
npm run eval -- mylabel --repeat 3                          # benchmark (--retrieval-only for a fast check)
npm test
```

PowerShell: `$env:SEC_USER_AGENT="Your Name you@example.com"; npm run fetch`. The SEC requires a contact in the User-Agent header.

Your profile lives in `data/state/shared_memory.json`; edit it freely. `ask` prints the sources it used and the latency figures.

## Repository layout

```
src/core/       platform-independent engine (shared with the app)
  chunker         recursive splitter, 500 chars / 100 overlap
  bm25            keyword scoring for hybrid search
  vectorStore     hybrid top-K, company filter, recency, de-duplication
  memory          profile store, token budget, focus, insight write-back
  promptBuilder   answer and insight prompts
  copilot         retrieve -> fuse -> generate; learn()
  models          model files and runtime limits shared by desktop and phone
src/desktop/    node-llama-cpp engine, file storage, index loader
src/ingest/     SEC EDGAR client, HTML-to-text
scripts/        CLI: models, fetch, index, ask, eval
tests/          unit tests (vitest)
app/            Android app (React Native + llama.rn)
```
