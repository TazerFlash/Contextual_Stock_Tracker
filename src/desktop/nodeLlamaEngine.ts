import {
  getLlama,
  LlamaChatSession,
  resolveModelFile,
  type LlamaContext,
  type LlamaEmbeddingContext,
  type LlamaModel,
} from "node-llama-cpp";
import { MODELS, PATHS, RUNTIME } from "../config";
import type { GenerateOptions, LlmEngine, Prompt } from "../core/types";

// BERT-family embedders take 512-token inputs; leave room for [CLS]/[SEP].
const EMBED_MAX_TOKENS = 500;

export interface EngineOptions {
  /** Omit to load only the embedding model (e.g. for index building). */
  withChat?: boolean;
  threads?: number;
  contextSize?: number;
}

/** Desktop LlmEngine on node-llama-cpp. The phone version wraps llama.rn behind the same interface. */
export class NodeLlamaEngine implements LlmEngine {
  private constructor(
    private readonly embedModel: LlamaModel,
    private readonly embedContext: LlamaEmbeddingContext,
    private readonly chatContext: LlamaContext | null,
    private readonly session: LlamaChatSession | null,
  ) {}

  /** Token count under the chat model's tokenizer (for measuring prompt size). */
  countTokens(text: string): number {
    if (!this.chatContext) throw new Error("Engine was created without the chat model (withChat: false)");
    return this.chatContext.model.tokenize(text).length;
  }

  static async create(options: EngineOptions = {}): Promise<NodeLlamaEngine> {
    const threads = options.threads ?? RUNTIME.threads;
    // CPU only, so desktop numbers are closer to what a phone CPU will see.
    const llama = await getLlama({ gpu: false });

    const embedModel = await llama.loadModel({ modelPath: await localModel(MODELS.embed) });
    const embedContext = await embedModel.createEmbeddingContext({ threads });

    if (!options.withChat) return new NodeLlamaEngine(embedModel, embedContext, null, null);

    const chatModel = await llama.loadModel({ modelPath: await localModel(MODELS.chat) });
    const chatContext = await chatModel.createContext({
      contextSize: options.contextSize ?? RUNTIME.contextSize,
      threads,
    });
    const session = new LlamaChatSession({ contextSequence: chatContext.getSequence() });
    return new NodeLlamaEngine(embedModel, embedContext, chatContext, session);
  }

  async embed(text: string, kind: "query" | "passage" = "passage"): Promise<number[]> {
    const full = kind === "query" ? MODELS.embedQueryPrefix + text : text;
    const tokens = this.embedModel.tokenize(full);
    const input = tokens.length > EMBED_MAX_TOKENS ? this.embedModel.detokenize(tokens.slice(0, EMBED_MAX_TOKENS)) : full;
    const embedding = await this.embedContext.getEmbeddingFor(input);
    return [...embedding.vector];
  }

  async generate(prompt: Prompt, options: GenerateOptions): Promise<string> {
    if (!this.session) throw new Error("Engine was created without the chat model (withChat: false)");
    // Every call is a fresh single-turn conversation; the prompt carries all the context.
    this.session.setChatHistory([{ type: "system", text: prompt.system }]);
    return this.session.prompt(prompt.user, {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      customStopTriggers: options.stop,
      repeatPenalty: options.repeatPenalty ? { penalty: options.repeatPenalty } : undefined,
      onTextChunk: options.onToken,
    });
  }

  async dispose(): Promise<void> {
    await this.chatContext?.dispose();
    await this.embedContext.dispose();
  }
}

/** Path of an already-downloaded model; tells you to run `npm run models` instead of downloading silently. */
async function localModel(uri: string): Promise<string> {
  try {
    return await resolveModelFile(uri, { directory: PATHS.models, download: false, cli: false });
  } catch {
    throw new Error(`Model not downloaded: ${uri}\nRun: npm run models`);
  }
}
