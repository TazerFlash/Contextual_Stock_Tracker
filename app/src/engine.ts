import { initLlama, releaseAllLlama, type LlamaContext } from 'llama.rn';
import { EMBED_MODEL, RUNTIME } from '../../src/core/models';
import type { GenerateOptions, LlmEngine, Prompt } from '../../src/core/types';

// Qwen's chat template ends turns with this token; stop on it in case the template doesn't.
const END_OF_TURN = '<|im_end|>';

/** Phone LlmEngine on llama.rn: the same interface the desktop engine implements with node-llama-cpp. */
export class LlamaRnEngine implements LlmEngine {
  private constructor(
    private readonly chat: LlamaContext,
    private readonly embedder: LlamaContext,
  ) {}

  static async create(chatModelPath: string, embedModelPath: string): Promise<LlamaRnEngine> {
    // A JS reload (dev) re-runs this while the previous native contexts are still loaded; free them
    // first or the models end up in memory twice.
    await releaseAllLlama();
    const embedder = await initLlama({
      model: `file://${embedModelPath}`,
      embedding: true,
      n_ctx: 512,
      n_threads: RUNTIME.threads,
    });
    const chat = await initLlama({
      model: `file://${chatModelPath}`,
      n_ctx: RUNTIME.contextSize,
      n_threads: RUNTIME.threads,
      n_gpu_layers: 0, // CPU, matching the desktop measurements
    });
    return new LlamaRnEngine(chat, embedder);
  }

  async embed(text: string, kind: 'query' | 'passage' = 'passage'): Promise<number[]> {
    const input = kind === 'query' ? EMBED_MODEL.queryPrefix + text : text;
    // Every query starts with the same prefix, so llama.rn would reuse those cached tokens; bge is an
    // encoder that must see the whole input at once, and the second query then failed natively
    // ("Exception in HostFunction"). Clearing first makes each embedding start from scratch.
    await this.embedder.clearCache(false);
    return (await this.embedder.embedding(input)).embedding;
  }

  async generate(prompt: Prompt, options: GenerateOptions): Promise<string> {
    const result = await this.chat.completion(
      {
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        n_predict: options.maxTokens,
        temperature: options.temperature,
        penalty_repeat: options.repeatPenalty,
        stop: [...options.stop, END_OF_TURN],
      },
      (data) => options.onToken?.(data.token),
    );
    return result.text;
  }

  async release(): Promise<void> {
    await Promise.all([this.chat.release(), this.embedder.release()]);
  }
}
