// Desktop-side settings. Model definitions and runtime limits shared with the phone app live in src/core/models.ts.
import { CHAT_MODELS, EMBED_MODEL } from "./core/models";

export { RUNTIME } from "./core/models";

/** Pick with the CHAT_MODEL env var ("0.5b" default, "1.5b"). */
function chatModel(): string {
  const name = (process.env.CHAT_MODEL ?? "0.5b").toLowerCase();
  if (!(name in CHAT_MODELS)) throw new Error(`CHAT_MODEL must be one of: ${Object.keys(CHAT_MODELS).join(", ")}`);
  return CHAT_MODELS[name as keyof typeof CHAT_MODELS].uri;
}

export const MODELS = {
  chat: chatModel(),
  embed: EMBED_MODEL.uri,
  embedQueryPrefix: EMBED_MODEL.queryPrefix,
};

export const PATHS = {
  models: "models",
  corpus: "data/corpus",
  manifest: "data/corpus/manifest.json",
  index: "data/index/index.json",
  vectors: "data/index/vectors.f32",
  state: "data/state",
};

export const INGEST = {
  tickers: ["AAPL", "MSFT", "NVDA"],
  forms: ["10-K", "10-Q"],
  chunkSize: 500,
  chunkOverlap: 100,
  /** Shorter chunks are mostly orphaned headings ("Gross Profit and Gross Margin") that crowd out answers. */
  minChunkChars: 100,
};
