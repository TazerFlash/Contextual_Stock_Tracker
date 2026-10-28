// Usage: SEC_USER_AGENT="Your Name you@example.com" npm run fetch [-- TICKER ...]
// Saves the latest 10-K and 10-Q per ticker as plain text plus a manifest for build-index.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { INGEST, PATHS } from "../src/config";
import { EdgarClient, type FilingRef } from "../src/ingest/edgar";
import { htmlToText } from "../src/ingest/htmlToText";

export interface ManifestEntry extends FilingRef {
  file: string;
  chars: number;
}

const tickers = process.argv.slice(2).length ? process.argv.slice(2) : INGEST.tickers;
const edgar = new EdgarClient(process.env.SEC_USER_AGENT ?? "");
await mkdir(PATHS.corpus, { recursive: true });

const manifest: ManifestEntry[] = [];
for (const ticker of tickers) {
  for (const ref of await edgar.latestFilings(ticker, INGEST.forms)) {
    const text = htmlToText(await edgar.fetchDocument(ref.url));
    const file = `${ref.ticker}_${ref.form}_${ref.filedAt}.txt`;
    await writeFile(join(PATHS.corpus, file), text, "utf8");
    manifest.push({ ...ref, file, chars: text.length });
    console.log(`${file}  ${(text.length / 1000).toFixed(0)}k chars`);
  }
}

await writeFile(PATHS.manifest, JSON.stringify(manifest, null, 2), "utf8");
console.log(`\n${manifest.length} filings -> ${PATHS.manifest}`);
