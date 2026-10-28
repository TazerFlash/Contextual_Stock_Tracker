// Downloads the configured chat model (CHAT_MODEL env var, default 0.5b) and the embedder into ./models.
import { resolveModelFile } from "node-llama-cpp";
import { MODELS, PATHS } from "../src/config";

for (const [name, uri] of Object.entries({ chat: MODELS.chat, embed: MODELS.embed })) {
  const path = await resolveModelFile(uri, PATHS.models);
  console.log(`${name}: ${path}`);
}
