# Contextual Stock Tracker: Problem Statement, PRD & Implementation Log

**Target Deployment:** Mobile Edge (On-Device AI / React Native)
**Hackathon Track:** Edge AI / Privacy-Preserving On-Device Intelligence
**Last updated:** 2026-10-28

> Part 1 is the product definition. Part 2 is the build log of the 2026-10-28 rebuild.
> Where the rebuild changed a technical choice, the PRD is updated and marked **[Updated]**.

---

# Part 1: Problem Statement & PRD

## 1. Problem Statement

### 1.1 The Core Dilemma
Retail investors and financial analysts rely on real-time news, filings (10-Ks, 10-Qs) and market movements to make investment decisions. Current market-event intelligence tools have three friction points:

1. **Privacy & Data Security Risks:**
   Cloud-based LLM assistants require users to send sensitive portfolio holdings, target prices and investment theses to third-party servers. For high-net-worth individuals and privacy-conscious investors, portfolio leakage is an unacceptable compliance and privacy risk.
2. **Network Latency & Offline Inaccessibility:**
   Cloud round-trips for document ingestion, embedding search and LLM inference often add 3–8 seconds of latency. In fast-moving or volatile market-open conditions, users need instant synthesis on their own devices.
3. **Contextual Disconnect (Generic vs. Personal):**
   Standard financial tools give generic summaries that fail to answer: *"How does this specific news item affect MY active portfolio, MY target prices and MY risk goals?"* Pure personalized trackers, on the other hand, lack grounding in historical filings and authoritative corporate data.

### 1.2 Proposed Solution
An **offline-first, on-device contextual financial copilot** built on a dual-memory architecture:
* **Zero-Knowledge Architecture:** Queries, portfolio context and generated answers never leave the mobile device.
* **Dual-Memory Synthesis:** Fuses broad, static corporate filings (Layer 1: On-Device RAG) with hyper-personalized investment context (Layer 2: Shared Memory) through a local quantized LLM running on mobile hardware.

---

## 2. Target Audience & User Personas

| Persona | Needs & Goals | Pain Points with Existing Tools |
| :--- | :--- | :--- |
| **Retail Active Trader** | Instant contextual analysis of breaking news against active watchlists and price targets. | Generic market alerts require manual cross-referencing against personal portfolio sheets. |
| **Privacy-Conscious Investor** | AI assistance without sending financial positions, entry prices or trading notes to cloud APIs. | Reluctant to use cloud LLMs due to data harvesting and security concerns. |
| **Mobile Analyst on the Go** | Responsive, battery-efficient mobile copilot that works on commutes or weak cellular connections. | High cloud latency and failures on unstable connections. |

---

## 3. Product Goals & Success Metrics

### 3.1 Qualitative Goals
* Deliver immediate, grounded answers tailored to the user's specific watchlist.
* Prove that sub-1B-parameter models can do coherent financial reasoning on consumer mobile hardware.
* Keep the entire analysis workflow private and on-device.

### 3.2 Quantitative KPIs
* **On-Device Inference Latency:** ≤ 2.0 s to first token on modern mid-range/flagship mobile CPUs/NPUs.
* **Cold Model Load Time:** ≤ 3.5 s to load the GGUF model into memory.
* **Memory Footprint [Updated 2026-10-28]:** ≤ 600 MB of **app-owned memory** during active inference: KV cache, compute buffers, search index and JS heap. Measured as private memory (Android: private dirty in `dumpsys meminfo`; Windows: private bytes).
  The memory-mapped model weights (~530 MB: 491 MB chat model Q4_K_M + 37 MB embedder) are file-backed pages the OS can evict and re-read, so they're **reported separately, not counted** toward the 600 MB. The original "total RAM" wording couldn't be met by any sub-1B model with a large vocabulary: the chat model file alone is 491 MB (see Part 2, §8).
* **Context Budget:** Shared Memory context capped at ≤ 1,000 tokens so compact models don't run out of context window.

---

## 4. System Architecture & Dual-Memory Design

```
+--------------------------------------------------------------------------------+
|                             MOBILE DEVICE (100% On-Device)                     |
|                                                                                |
|  [ User Input Query ]                                                          |
|           |                                                                    |
|           v                                                                    |
|  [ Local Embedding Model: bge-small GGUF ] ----> Query Vector                  |
|           |                                                                    |
|           v                                                                    |
|  [ Local Vector Index (JSON, cosine) ] ----> Top-K Chunks (Layer 1)            |
|                                                                                |
|  [ Local Cache (AsyncStorage) ] -----------> User Portfolio/Notes (Layer 2)    |
|                                                                                |
|           +---------------------------------------------+                      |
|           |              Prompt Builder                 |                      |
|           |  - System Instruction (Analyst Role)        |                      |
|           |  - Layer 2: Shared Memory Context           |                      |
|           |  - Layer 1: Grounded RAG Chunks             |                      |
|           |  - User Query                               |                      |
|           +---------------------------------------------+                      |
|                                  |                                             |
|                                  v                                             |
|                [ Local LLM: Qwen2.5-0.5B-Instruct GGUF ]                       |
|                                  |                                             |
|                                  v                                             |
|                   [ UI: Personalized Answer ]                                  |
+--------------------------------------------------------------------------------+
```
**[Updated]** FAISS was replaced by a JSON vector index with hybrid (vector + keyword) search, and Qwen1.5-0.5B by Qwen2.5-0.5B-Instruct (see Part 2, §2 and §5).

### 4.1 Layer 1: On-Device RAG (Long-Term Grounded Knowledge)
* **Purpose:** Static, authoritative background knowledge (10-K/10-Q reports, industry glossaries, historical earnings records).
* **Storage [Updated]:** Two local files: `index.json` (chunk text and source metadata: ticker, form, filing date, URL) and `vectors.f32` (unit-normalized embeddings as raw Float32, ~5 MB for ~3,300 chunks). They replace `index.faiss` + `index.pkl`, which can't be loaded in React Native.
* **Embedding Model [Updated]:** `BAAI/bge-small-en-v1.5` (384-d, GGUF Q8_0, ~36 MB), run by the same llama.cpp engine as the chat model. It replaces the ONNX export and, after tuning, all-MiniLM-L6-v2, which ranked boilerplate above answers.
* **Search [Updated]:** Hybrid ranking. Vector similarity and BM25 keyword scores are fused by reciprocal rank, near-duplicate passages are skipped, and company names are removed from the search text once used to filter by company.
* **Chunking Strategy [Updated]:** Recursive character splitting, 500-character chunks with 100-character overlap (was 1,000 / 200), dropping scraps under 100 characters. Number-heavy tables and repeated page headers/footers are removed during ingestion; the same figures appear in the MD&A prose.
* **Corpus:** Latest 10-K and 10-Q for each watchlist ticker, pulled from SEC EDGAR.

### 4.2 Layer 2: Shared Memory (Real-Time Dynamic Context)
* **Purpose:** Stores small, high-value, structured user state.
* **Payload Constraints:** Strict upper bound of ≤ 1,000 tokens.
* **Schema:**
  ```json
  {
    "userId": "usr_alpha_01",
    "watchlist": ["AAPL", "MSFT", "NVDA"],
    "targetPrices": { "NVDA": 1200, "MSFT": 480 },
    "portfolioNotes": "Looking to trim AAPL if revenue guidance drops post-earnings.",
    "recentSentiment": { "MSFT": "Strong Buy", "NVDA": "Neutral/Overbought" },
    "insights": [{ "text": "<=15-word learned takeaway", "createdAt": "ISO-8601" }]
  }
  ```
  **[Updated]** `insights` was added to hold the FR-04 memory-loop write-backs.
* **Synchronization:** Kept in a local persistent cache (`AsyncStorage` on mobile; a JSON file on desktop), with optional low-latency cloud sync (Firebase/Supabase).

---

## 5. Functional Requirements

### FR-01: Local Knowledge Retrieval (RAG)
* System MUST accept a raw natural-language query from the user.
* System MUST compute embeddings locally on-device.
* System MUST search the bundled vector index and return the top K = 3 most relevant chunks, narrowed to companies the query mentions when it names any.

### FR-02: Prompt Synthesis & Fusion
* System MUST build a combined prompt containing:
  1. A system prompt setting the role of a concise financial analyst.
  2. The active Layer 2 Shared Memory state.
  3. The retrieved Layer 1 RAG chunks.
  4. The user query.
* The prompt MUST explicitly guide the model to integrate both layers using a Chain-of-Thought pattern. **[Updated]** The model works through an ordered format: *Facts → Impact on you → Bottom line*.

### FR-03: On-Device LLM Inference
* The model MUST run 100% locally using 4-bit quantized weights (GGUF Q4_K_M).
* System MUST enforce stop tokens to prevent generation drift. **[Updated]** The stop token is `###`; `ANALYSIS:` was dropped in favor of the structured answer format.
* Inference MUST run asynchronously without blocking the mobile UI thread.

### FR-04: Memory Loop (Dynamic Context Update)
* Upon positive user feedback on an answer, the model MUST produce a concise, one-sentence insight (max 15 words).
* System MUST write this insight back into the local Layer 2 cache to inform future queries.

---

## 6. Non-Functional Requirements

### NFR-01: Privacy & Zero Leakage
* The query string, user watchlist, target prices and generated answers MUST NOT be sent across the network.
* Only non-sensitive, encrypted Layer 2 state may sync to optional cloud mirrors.

### NFR-02: Offline Resilience
* The application MUST stay fully functional (retrieval + inference) in Airplane Mode.

### NFR-03: Battery & Compute Constraints
* CPU inference MUST use a bounded number of threads (default: 4) to prevent thermal throttling and severe battery drain.

---

## 7. Technical Specifications & Dependencies **[Updated]**

| Layer | Component | Chosen Technology |
| :--- | :--- | :--- |
| **Core logic** | Platform-agnostic engine | TypeScript (`src/core/`), shared by desktop and mobile |
| **Mobile Runtime** | Cross-platform framework | React Native (TypeScript) |
| **Inference Engine** | llama.cpp bindings | `llama.rn` (mobile) / `node-llama-cpp` (desktop) |
| **Local LLM** | Small language model | Qwen2.5-0.5B-Instruct (GGUF Q4_K_M), 2,048-token context |
| **Embeddings** | Dense vector encoder | bge-small-en-v1.5 (GGUF Q8_0, 384-d) |
| **Vector Index** | Similarity search | JSON index; hybrid cosine + BM25 top-K |
| **Data Source** | Layer 1 corpus | SEC EDGAR 10-K / 10-Q |
| **Platform Target** | Mobile OS | Android (SDK 33+) / iOS (iOS 16+) |

---

## 8. Release Roadmap **[Updated]**

* **Phase 1 (Done, rebuilt 2026-10-28):** Engine core: chunking, vector search, shared memory, prompt fusion, memory loop, SEC ingestion, desktop CLI, unit tests.
* **Phase 2 (In progress):** End-to-end validation and tuning on desktop. Done: index, eval harness, first tuning round (retrieval hit@3 2/6 → 5/6, latency about halved). 0.5B vs 1.5B compared: staying on 0.5B. RAM cut: index 95 → 43 MB, process 888 → ~735–840 MB, ~256 MB private. RAM KPI redefined as app-owned memory (≤ 600 MB; ~256 MB on desktop ✅). Accuracy round: recency + scoped notes + question-first (right excerpt sent 18/18, note leaks 2 → 0; facts flat at ~10–11/18 because the model answers from excerpt [1]). Open: rank-1 precision, first-token KPI.
* **Phase 3 (In progress, paused):** React Native app in `app/` with the llama.rn engine adapter, file storage and Ask/Profile screens, reusing `src/core/` unchanged. Runs end to end on the emulator; emulator speed fix built but not yet verified (Part 2, §10).
* **Phase 4 (Demo & Pitch):** Live offline vs. cloud latency comparison; verify zero network calls during query generation.

---

# Part 2: Implementation Log

**Scope of this round:** the engine only (retrieval, prompt fusion, memory loop, local inference), running on a Windows PC. The mobile app UI is deliberately deferred.

---

## 1. Where the previous attempt stood

Audit of the old WSL project (`~/contextual-tracker` in Ubuntu):

| Item | Finding |
|---|---|
| `qwen_final_q4k.gguf` (320 MB) | Present, but quantized from the **base** Qwen1.5-0.5B (not instruction-tuned), so it doesn't reliably follow answer formats |
| `rag_index_faiss/` | `index.faiss` is 6 KB, about 4 vectors: effectively empty |
| `rag_corpus/` | Contained only the indexing script, no documents |
| `minilm_onnx_model/` | Present, but needs a separate ONNX runtime on mobile |
| React Native app (`StockTrackerApp`) | No longer exists |

The design itself had blockers on mobile:
- `index.pkl` is a Python pickle that React Native can't read.
- FAISS and ONNX each need their own native module on the phone.
- `new Llama({ model: require(...) })` is not the `llama.rn` API. Bundling a 400 MB model through Metro `require` also doesn't work.

## 2. Rebuild decisions

| Original | Rebuild | Reason |
|---|---|---|
| Qwen1.5-0.5B base, self-quantized in WSL | **Qwen2.5-0.5B-Instruct Q4_K_M**, prebuilt GGUF from Hugging Face | Follows instructions; no llama.cpp build |
| MiniLM ONNX + FAISS + pickle | **bge-small GGUF** + **JSON index** with hybrid cosine + BM25 search | One engine (llama.cpp) for chat and embeddings; JSON loads anywhere (see §5 for why MiniLM was dropped) |
| WSL / Python pipeline | **TypeScript on Node** (Windows) | No toolchain friction; the same code runs in React Native |
| `nCtx` 2048 | **2048** (briefly 4096) | 4096 was needed for 1,000-char chunks; after tuning, prompts are ~480 tokens + 200 output |
| Stop tokens `###`, `ANALYSIS:` | Stop on `###`; answer in a fixed **Facts / Impact on you / Bottom line** format | Structured reasoning a 0.5B model can follow |

Key architecture point: the code is split into a **platform-agnostic core** and a thin **platform adapter**. The phone app will reuse `src/core/` unchanged and swap only the engine (`node-llama-cpp` → `llama.rn`) and storage (files → `AsyncStorage`).

## 3. What was built

```
package.json, tsconfig.json, .gitignore, README.md
src/
  config.ts              model URIs, paths, threads (4), context size, ingest settings
  core/                  ← reused by the mobile app
    types.ts             SharedMemory, VectorIndex, LlmEngine, KeyValueStorage interfaces
    chunker.ts           recursive splitter (500 chars / 100 overlap), LangChain-style
    bm25.ts              keyword scoring for hybrid search
    vectorStore.ts       cosine top-K, ticker filter, company/ticker mention detection
    memory.ts            Layer 2 store: default profile, ≤1,000-token budget, insight write-back
    promptBuilder.ts     dual-memory fusion prompt, insight prompt, insight cleanup (≤15 words)
    copilot.ts           ask(): embed → retrieve → load memory → generate (with timings); learn()
  desktop/
    nodeLlamaEngine.ts   LlmEngine on node-llama-cpp, CPU-only, 4 threads
    fileStorage.ts       AsyncStorage stand-in (JSON file per key)
  ingest/
    edgar.ts             SEC EDGAR client (ticker → CIK → latest 10-K/10-Q)
    htmlToText.ts        inline-XBRL HTML → clean paragraphs
scripts/
  download-models.ts     npm run models
  fetch-filings.ts       npm run fetch
  build-index.ts         npm run index
  ask.ts                 npm run ask (REPL with sources, timings and feedback loop)
tests/core.test.ts       14 unit tests
```

### PRD requirement coverage

| Requirement | Implementation |
|---|---|
| FR-01 Local retrieval, top K=3 | `Copilot.ask` embeds the query locally; `VectorStore.search` returns the top 3, narrowed to companies the question mentions |
| FR-02 Prompt fusion + CoT | `buildAnswerPrompt`: system role → USER CONTEXT (Layer 2) → FILING EXCERPTS (Layer 1, cited `[n]`) → QUESTION → ordered reasoning format |
| FR-03 Local 4-bit inference, stop tokens, async | Q4_K_M GGUF via node-llama-cpp; stop on `###`; streaming tokens |
| FR-04 Memory loop | `Copilot.learn` → ≤15-word insight → `MemoryStore.addInsight` (deduped) → included in later prompts |
| NFR-01 Privacy | All embedding, retrieval and generation run locally; network is used only to download models and public SEC filings |
| NFR-03 Bounded threads | `RUNTIME.threads = 4` |
| KPI instrumentation | `ask` prints model load time (target ≤3.5 s) and time to first token (target ≤2.0 s) |

## 4. Verification so far

- `tsc --noEmit`: clean.
- `vitest`: **14/14 passing**. They cover chunk size and overlap, cosine ranking and ticker filtering, company-name detection, memory seeding, dedup and token budget, prompt fusion, insight cleanup, the full copilot flow with a fake engine (insight flows into the next prompt), and HTML-to-text cleanup.
- **SEC fetch ran successfully** (User-Agent: app name + account email):

| File | Size |
|---|---|
| AAPL_10-K_2025-10-31.txt | 205k chars |
| AAPL_10-Q_2026-07-31.txt | 83k chars |
| MSFT_10-K_2026-07-29.txt | 312k chars |
| MSFT_10-Q_2026-04-29.txt | 195k chars |
| NVDA_10-K_2026-02-25.txt | 339k chars |
| NVDA_10-Q_2026-08-26.txt | 147k chars |

  A spot-check shows clean prose with real figures, for example the NVDA 10-Q: "Data Center revenue was $89.0 billion, up 117% from a year ago".

## 5. In progress / not yet verified

- [x] Model download (`npm run models`): Qwen2.5-0.5B-Instruct Q4_K_M 491 MB, MiniLM Q8_0 25 MB (bge-small Q8_0 37 MB added in §6)
- [x] Build the embedding index (`npm run index`): **1,798 chunks, 384-d, 73 s, 7.5 MB JSON**
- [x] (First pass, since replaced) MiniLM GGUF embeddings are sensible: paraphrase pair cosine **0.63**, unrelated pair **−0.04**. (The "tokenize/detokenize mismatch" warning is harmless: MiniLM is uncased.)
- [x] Retrieval relevance: export-control, iPhone-revenue and Azure-growth queries all return the right company and section
- [x] Fixed: 10-K and 10-Q repeat whole paragraphs, so one paragraph could fill two top-3 slots. Search now skips near-duplicates (cosine > 0.97). 15/15 tests passing.
- [x] First end-to-end questions through `npm run ask` (results below)

### First end-to-end run (desktop CPU, 4 threads, no GPU)

| Metric | Result | KPI | Status |
|---|---|---|---|
| Model load (chat + embed) | 1.9–3.1 s | ≤ 3.5 s | ✅ |
| Query embed + retrieval | 20–30 ms | — | ✅ |
| Time to first token | 4.9–6.0 s | ≤ 2.0 s | ❌ (prompt is ~1,000 tokens, measured in §6; this CPU reads only ~170 prompt tokens/s) |
| Full answer | 8–10 s | — | — |

**Answer quality: weak.**
- *"Should I be worried about NVIDIA's China export controls given my target price?"*: gets the gist (significant China exposure under export-control pressure) and ties it to the watchlist, but repeats the target-price list and adds an ungrounded line about losing value below $1,200.
- *"Did Apple's iPhone revenue grow, and does that affect my plan to trim AAPL?"*: repeats the user profile back and ignores the retrieved figure (iPhone net sales $209.6B, +4%). The retrieved Apple chunks were mostly table fragments, which a 0.5B model reads poorly.

**Diagnosis:** retrieval and plumbing work. The bottlenecks are (1) prompt length, which drives first-token latency, and (2) a 0.5B model's ability to pull facts out of long, table-heavy excerpts.

## 6. Tuning round: answer quality and latency

### Method
`npm run eval -- <label>` runs a fixed set of 6 questions against the default profile, with no learned insights, so runs are comparable. Each answer is scored on:
- **Retrieval hit@3:** is the passage that answers the question (matched by regex) among the 3 excerpts sent to the model?
- **Fact:** does the answer contain the ground-truth figure or reason?
- **Personal:** does the answer use the investor's profile (target price, sentiment or notes for that stock)?
- **Speed:** prompt tokens, time to first token, and total time.

`--retrieval-only` checks hit@3 in seconds without generating answers. Ground truth comes from the filings: NVDA Data Center $89.0B (+117%); Azure revenue +40%/41%; iPhone growth driven by Pro models; NVDA export-control risk; NVDA quarterly gross margin 75.0%.

### What changed, and why

| # | Change | Reason (observed) |
|---|---|---|
| 1 | Chunks 1,000/200 → **500/100** chars; drop chunks < 100 chars | Halves prompt size; heading-only scraps were taking excerpt slots |
| 2 | **Drop number-heavy tables** during ingestion | Flattened tables lose their column headers ("Gross margin 75.0 % 74.9 % 72.4 %"); the model can't tell periods apart. The same figures are stated in MD&A prose |
| 3 | **Strip repeated page headers/footers** | "NVIDIA Corporation and Subsidiaries / Notes to … (Continued)" made boilerplate look relevant to every NVIDIA question |
| 4 | **Profile shown per ticker, and only for stocks the question names** | The model attached NVDA's $1,200 target to MSFT |
| 5 | Prompt order: **excerpts → profile → question**; "quote numbers exactly" | Small models anchor better on facts placed first and the question last |
| 6 | Temperature 0.7 → **0.2**, **repeat penalty 1.1**, max output 512 → **200** tokens | Baseline answers looped (one repeated itself 3×; one printed endless zeros) |
| 7 | **Hybrid search**: BM25 keywords + vectors, fused by reciprocal rank | Vector-only search ranked the right passage 4th, 9th and 51st |
| 8 | Embedder **all-MiniLM-L6-v2 → bge-small-en-v1.5** (same size class, query instruction prefix) | Trained for question → passage search |
| 9 | **Remove company names from the search text** after filtering by company | Every NVIDIA chunk says "NVIDIA"; keeping it pulled boilerplate up |

### Results

| Run | Retrieval hit@3 | Fact | Personal | Prompt tokens | First token | Total |
|---|---|---|---|---|---|---|
| Baseline | not measured | 2/6 | 3/6 | 994 | 5.97 s | 12.9 s |
| + changes 1–6 | not measured | 3/6 | 1/6 | ~500 | 3.17 s | 5.8 s |
| + hybrid search (7) | 2/6 | 3/6 | 5/6 | ~470 | 2.89 s | 5.5 s |
| + bge, header strip, name strip (8–9) | **5/6** | 3/6 | 2/6 | 478 | 3.32 s | 7.2 s |

Retrieval-only checks along the way: vector-only search with MiniLM got 2/6, and bge alone, before the header and company-name fixes, also got 2/6. The two cleanup fixes are what moved it to 5/6.

*Notes:* each question runs once, so scores and timings vary by about ±1 between runs; treat small differences as noise. Prompt tokens in the second and third rows were measured with the unfocused profile, so they're slightly overstated.

### What the numbers say
- **Latency roughly halved** (first token 6.0 s → ~3 s, total 12.9 s → 5–7 s), driven by the prompt halving. The ≤ 2.0 s KPI is still missed on this laptop CPU (~170 prompt tokens/s). A modern phone processes prompts at similar or higher speed, so it must be re-measured on-device.
- **Retrieval is mostly solved** (2/6 → 5/6). The remaining miss is NVDA Data Center at rank 5: "last quarter" needs a sense of recency the search doesn't have.
- **The 0.5B model is now the bottleneck.**
  - *Azure:* the right passage ("Azure and other cloud services revenue grew 40%") was in the prompt, but the model quoted the adjacent gross-margin sentence.
  - *Data Center:* it made up "20%".
  - It also applies the global note ("trim AAPL…") to other stocks.
- The fact metric is strict. The final gross-margin answer is correct and grounded ("decreased in fiscal 2026 … $4.5 billion H20 charge") but describes the fiscal year, not the quarter the check expects.

### Final sample answer (iPhone + trim plan)
> **Facts:** The iPhone net sales increased during the third quarter and first nine months of 2026 compared to the same periods in 2025…
> **Impact on you:** You may be considering trimming AAPL if revenue guidance falls short…

## 7. Model-size experiment: Qwen2.5-0.5B vs 1.5B

Question: is the chat model's size what limits answer accuracy? Both models ran the same 6-question eval on identical retrieval and prompts. The chat model is chosen with `CHAT_MODEL=0.5b|1.5b` (default 0.5b); the eval now also records process RAM.

| | Qwen2.5-0.5B (Q4_K_M, 491 MB) | Qwen2.5-1.5B (Q4_K_M, ~1.1 GB) |
|---|---|---|
| Retrieval hit@3 | 5/6 | 5/6 (same search) |
| Correct fact | 4/6 | 3/6 |
| Uses profile | 3/6 | 3/6 |
| First token | 3.2 s | 5.2 s |
| Full answer | 6.7 s | 9.0 s |
| Process RAM (RSS) | 888 MB | 2,056 MB |

**Reading the answers, not just the scores:**
- **1.5B is more faithful.** It invented no numbers (0.5B said Data Center grew "10%", and in an earlier run "20%"). It never echoed the prompt template back (0.5B pasted "The specific figures or reasons from the excerpts…" into one answer). Its three-line format held every time.
- **1.5B is not more accurate.** It picked the same wrong Azure sentence (the gross-margin line instead of "revenue grew 40%"). It also said Data Center "grew" without giving $89.0B/+117%, and it still let the AAPL trim note leak into other answers.
- Differences of ±1 on 6 questions are within run-to-run noise. The 0.5B rerun scored 4/6 facts against 3/6 in §6 with nothing changed.

**Conclusion: stay on 0.5B.** The bigger model costs ~60% more latency and 2.3× the RAM, and buys fewer hallucinations but no more correct answers. The remaining errors come from *which* excerpt the model leans on, and from excerpts that state a fact indirectly, not from raw model capacity.

**New finding: the RAM KPI is at risk even with 0.5B.** 888 MB RSS against a ≤ 600 MB target. On desktop this includes the Node runtime (~50–100 MB), the embedder, the 4,096-token KV cache, llama.cpp compute buffers and the parsed JSON index. Ways to cut it:
- context size 4,096 → 2,048 (prompts are now ~480 tokens + 200 output)
- store the index as a binary Float32 file instead of JSON numbers
- measure on the phone, where there is no Node runtime

## 8. RAM reduction

### Where the memory went (0.5B, desktop, before changes)

| Stage | Added (RSS) |
|---|---|
| Node + tsx runtime | ~140 MB (desktop only; no Node on the phone) |
| JSON index parsed + search structures | ~95 MB |
| bge embedder + context | ~60 MB |
| Chat model weights (memory-mapped; all pages touched during generation) | ~490 MB |
| Chat context + compute buffers during generation | ~200 MB |

### What was tried

| Option | Result | Kept? |
|---|---|---|
| **Binary vector file**: `vectors.f32` (raw Float32) + `index.json` (metadata/text only), with vectors held as views into one buffer | Index in memory **95 → 43 MB**; files on disk **12.4 → 6.9 MB** | ✅ |
| **Context 4,096 → 2,048** (prompts are ~480 tokens + 200 output) | Private memory ~2 MB lower; a small, safe win | ✅ |
| llama.cpp batch size 512 → 128 | No consistent change (±40 MB noise) | ❌ |
| Flash attention | No consistent change | ❌ |
| Smaller quantization | Not tried. Even Q2_K is 415 MB (Q4_0 429 MB vs Q4_K_M 491 MB): Qwen's 151k-token vocabulary table sets a floor, so it would save at most ~60–75 MB at a quality cost | — |

### Results (6-question eval, three runs after the change)

| | Before | After |
|---|---|---|
| Process RSS (working set) | 888 MB | **735–842 MB** (varies with how many model pages are resident) |
| Private memory (owned by the process) | not measured | **~256 MB** |
| Retrieval hit@3 | 5/6 | 5/6 |
| Fact / personal | 4/6 · 3/6 | 3–4/6 · 2–4/6 (within noise) |
| First token | 3.2 s | 3.4–4.2 s (a 4,096-context control run gave 3.6 s, so this is noise, not a regression) |

### What this means for the ≤ 600 MB KPI
- Process memory splits into **~530 MB of memory-mapped model files** (491 MB chat + 37 MB embedder), which the OS can evict and re-read, plus **~256 MB the process owns**. That 256 MB includes Node and the JS heap, which a phone app won't have in this form.
- **Estimate for the phone app:** ~530 MB weights + ~100–150 MB own memory ≈ **630–680 MB**.
- **As originally written ("total RAM"), the KPI couldn't be met with Qwen2.5-0.5B Q4_K_M**, since the model file alone is 491 MB. The options were:
  - redefine the KPI to count app-owned memory separately from memory-mapped weights
  - raise it to ~750 MB
  - accept Q4_0 (−62 MB) and re-check quality

**Decision (2026-10-28): count app-owned memory only.** The KPI is now ≤ 600 MB of private memory, with memory-mapped weights (~530 MB) reported separately (PRD §3.2).
- On desktop, app-owned memory is **~256 MB, including the Node runtime**. That's **under the 600 MB target ✅**, with ~340 MB of headroom.
- Still to do: confirm on a real phone with private dirty memory from `adb shell dumpsys meminfo <package>`, and report the mapped weights next to it.

## 9. Accuracy round

### Eval changes first
- **`--repeat N`** asks each question N times; all runs below use N = 3, so 18 answers per run. Single runs moved by ±1 of 6 with nothing changed.
- **Latency counts only the first run of each question.** Repeats of an identical prompt reuse llama.cpp's cached prompt (first token ~40 ms instead of ~3.5 s), which would skew the averages. Side finding: this confirms prompt-prefix caching works in the engine.
- **`Copilot.retrieve()`** is now a separate method, so the eval's retrieval-only check uses exactly the same logic as real answers.

### What was tried

| Change | Facts | Profile used | Right excerpt sent | AAPL note leaking into NVDA/MSFT answers | Kept? |
|---|---|---|---|---|---|
| Baseline (end of §8) | 11/18 | 6/18 | 15/18 | 2/12 | — |
| **Recency**: "last quarter" / "latest" / "recent" questions search each company's newest filing first, then fall back | 10/18 | 4/18 | **18/18** | — | ✅ |
| **Scoped notes**: a note that names only other stocks is left out of the focused profile | (same run) | | | **0/12** | ✅ |
| **Question first**: the question opens the prompt ("Read all the excerpts…") and closes it | 10/18 | **7/18** | 18/18 | 0/12 | ✅ (+23 tokens; first token 3.6 s) |
| Sentence-level re-ranking: re-order the top 5–8 chunks by their best-matching sentence | evidence at [1] for 3/6 (unchanged); Azure pushed from rank 3 to 5–8; +300–400 ms | | | | ❌ |

### Key finding: the model answers from excerpt [1]
In every remaining failure the right passage was in the prompt, at position [2] or [3], and the model restated excerpt [1] instead:

| Question | Answer was in | Model said (from [1]) |
|---|---|---|
| NVDA Data Center growth | [2] "$89.0 billion, up 117%" | "growth … was driven by data center products" |
| Azure growth | [3] "Azure … revenue grew 40%" | "Azure gross margin percentage decreased to 67%" |
| NVDA gross margin | [3] "increased to 75.0% for the second quarter" | "decreased in fiscal year 2026 … $4.5 billion charge" (true, but for the fiscal year) |

So the limit is now **which chunk ranks first**, not whether the right one is retrieved (18/18). The 0.5B model largely ignores excerpts [2] and [3]; telling it to "read all the excerpts" didn't change that.

## 10. Android app (in progress, paused 2026-10-28)

### What exists
- **`app/`** is a React Native CLI project (RN 0.87.1, llama.rn 0.12.9) that reuses `src/core/` unchanged through Metro `watchFolders`.
  - **Engine:** `app/src/engine.ts` (llama.rn behind the same `LlmEngine` interface as the desktop engine).
  - **Storage:** `app/src/storage.ts` (profile in a JSON file).
  - **Models:** `app/src/models.ts` handles the one-time download into the app's private storage, with progress.
  - **Index:** `app/src/loadIndex.ts` loads `index.json` + `vectors.f32` bundled as APK assets.
  - **Screens:** setup/download; Ask (streamed answer, tappable sources, timings, 👍 to save a takeaway); Profile (watchlist, targets, sentiment, notes, saved takeaways).
- **Shared model definitions** moved to `src/core/models.ts`, so the desktop index and the phone's query embedder always match.
- **Verified on the Pixel 8 Pro emulator:** the app installs, loads the models and the 3,277-passage index, and answers a question end to end.

### Fixed along the way
- **Windows 260-character path limit** broke the C++ build. Workaround: build from a `subst` drive mapped to `app/` (`subst T: "...\COntextual Stock Tracker\app"`; it's gone after a reboot). The permanent fix is to move the project out of OneDrive to a short path such as `C:\dev\cst`.
- **Metro couldn't resolve `@babel/runtime` for `src/core`.** Fixed with `resolver.nodeModulesPaths` in `app/metro.config.js`.
- **Models `adb push`ed to `Android/data/...` were invisible to the app.** Android hides shell-owned files there. Models now live in private storage; for development, copy them in with `run-as` (below).
- **Second question failed with "Exception in HostFunction".** llama.rn reused the cached query prefix in the bge encoder. Fixed by `clearCache()` before each embedding. *Not yet verified with a second question.*
- **A JS reload loaded the models twice.** Fixed by `releaseAllLlama()` before loading. *Not yet verified.*

### Emulator speed (the open issue)
- **First full answer:** prompt at 3.8 tokens/s, generation at 3.4 tokens/s, ~2.7 min total. The desktop does ~170 prompt tokens/s on the same CPU.
- **Cause:** the x86_64 emulator lists both `x86_64` and `arm64-v8a`. llama.rn checks for ARM first (any listed ABI), finds no ARM libraries, and falls back to its **generic no-SIMD library**.
- **`app/scripts/patch-llama-rn.js`** (runs on `postinstall`) fixes this. It checks the *primary* ABI only, so ARM phones are unchanged, and switches the x86_64 build to AVX2 (`x86-64-v3`) for source builds.
- **Not yet verified:** the rebuild with the ABI fix was stopped before it finished.

### Resume here
```bash
cd app && npm run build:emulator          # from T:\ if the project is still under OneDrive; C++ is cached, so it's quick
adb install -r android/app/build/outputs/apk/debug/app-debug.apk   # -r keeps the models in private storage
adb reverse tcp:8081 tcp:8081 && npx react-native start
```
1. In `adb logcat`, confirm `rnllama_jni_x86_64` loads, not `rnllama_jni`.
2. Time the NVIDIA question again (before: 3.8 tokens/s prompt, 162 s total).
3. Ask a second question to verify the `clearCache()` fix.

If the models are missing (e.g. after the emulator restores an old snapshot):
```bash
adb push models/hf_Qwen_qwen2.5-0.5b-instruct-q4_k_m.gguf /data/local/tmp/qwen2.5-0.5b-instruct-q4_k_m.gguf
adb push models/hf_CompendiumLabs_bge-small-en-v1.5-q8_0.gguf /data/local/tmp/bge-small-en-v1.5-q8_0.gguf
adb shell "run-as com.stocktracker sh -c 'mkdir -p files/models && cp /data/local/tmp/*.gguf files/models/'"
```

## 11. Next

- **Better rank-1 precision with a small re-ranking model.** node-llama-cpp and llama.rn both support GGUF re-rankers (cross-encoders that score question + passage together). A tiny one such as jina-reranker-v1-tiny-en (~33M params) would fit the RAM budget. Measure evidence-at-[1] and facts with `--repeat 3`.
- **Confirm the RAM KPI on a real phone**: private dirty ≤ 600 MB, with mapped weights reported alongside.
- **Grow the eval set** beyond 6 questions; 6 is too few to see small effects.
- The React Native app: `llama.rn` engine adapter + `AsyncStorage`, reusing `src/core/` as-is; measure the latency KPIs on a real phone.

## How to run

```bash
npm install
npm run models
SEC_USER_AGENT="Your Name you@example.com" npm run fetch
npm run index
npm run ask
npm run eval -- mylabel          # add --retrieval-only for a fast retrieval check
npm test
```
