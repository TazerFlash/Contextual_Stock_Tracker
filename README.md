# Contextual Stock Tracker — engine

On-device financial copilot that fuses **Layer 1** (RAG over SEC filings) with **Layer 2**
(your watchlist, targets, notes and learned insights) through a local Qwen2.5-0.5B model.
This repo is the engine, runnable on a PC; the React Native app comes later and reuses `src/core/`.

```
src/core/      platform-agnostic logic (reused by the mobile app)
  chunker        recursive splitter, 500 chars / 100 overlap
  bm25           keyword scoring (hybrid search with the vectors)
  vectorStore    hybrid (cosine + BM25) top-K over a JSON index, ticker filter, dedup
  memory         Layer 2 store, <=1000-token budget, insight write-back
  promptBuilder  dual-memory fusion prompt, insight prompt
  copilot        embed -> retrieve -> fuse -> generate; learn()
src/desktop/   node-llama-cpp engine + file storage (mobile swaps in llama.rn + AsyncStorage)
src/ingest/    SEC EDGAR client + HTML-to-text
scripts/       CLI entry points
```

## Run it

```bash
npm install
npm run models                                         # ~530 MB: Qwen2.5-0.5B-Instruct Q4_K_M + bge-small GGUF (CHAT_MODEL=1.5b for the larger model)
SEC_USER_AGENT="Your Name you@example.com" npm run fetch   # latest 10-K + 10-Q for AAPL, MSFT, NVDA
npm run index                                          # chunk + embed -> data/index/index.json + vectors.f32
npm run ask                                            # interactive; or: npm run ask -- "your question"
npm run eval -- mylabel --repeat 3                     # fixed 6-question benchmark (--retrieval-only for a fast check)
npm test
```

PowerShell: `$env:SEC_USER_AGENT="Your Name you@example.com"; npm run fetch`

Your profile (Layer 2) lives in `data/state/shared_memory.json`. Edit it freely.
`ask` prints the sources used and the latency figures that map to the PRD KPIs (model load, first token).

## Changes from the original plan

| Original | Now | Why |
|---|---|---|
| Qwen1.5-0.5B base, self-quantized | Qwen2.5-0.5B-**Instruct** Q4_K_M, prebuilt | Follows instructions; no llama.cpp build |
| MiniLM ONNX + FAISS + `index.pkl` | bge-small GGUF + JSON index, hybrid cosine + BM25 | Pickle/FAISS can't load in React Native; one engine for everything; bge + keywords retrieve far better |
| WSL | Plain Windows/Node | No toolchain friction |
| `nCtx` 2048 | 2048 (briefly 4096) | Prompts shrank to ~480 tokens + 200 output after tuning, so 2048 fits again |
| Stop on `###`, `ANALYSIS:` | Stop on `###`; structured Facts / Impact / Bottom line | Chain-of-thought via fixed format suits a 0.5B model |
