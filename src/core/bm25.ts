// Okapi BM25 keyword scoring. Complements MiniLM, which ranks generic boilerplate above passages
// containing the exact terms a question hinges on ("gross margin", "Azure", "Data Center").

const STOPWORDS = new Set(
  ("a an and are as at be but by did do does for from had has have how i in is it its my of on or our " +
    "should that the their this to was were what when which who why will with would you your about " +
    "still any been more than into over last does affect").split(" "),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/** Very light stemming so "margins"/"margin" and "growing"/"grow" match. */
function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export class Bm25 {
  private readonly termFreqs: Map<string, number>[];
  private readonly lengths: number[];
  private readonly docFreq = new Map<string, number>();
  private readonly avgLength: number;

  constructor(
    texts: string[],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    this.termFreqs = texts.map((text) => {
      const tf = new Map<string, number>();
      for (const t of tokenize(text)) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
      return tf;
    });
    this.lengths = this.termFreqs.map((tf) => [...tf.values()].reduce((a, b) => a + b, 0));
    this.avgLength = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, texts.length);
  }

  score(query: string, doc: number): number {
    const n = this.termFreqs.length;
    const tf = this.termFreqs[doc];
    let score = 0;
    for (const term of new Set(tokenize(query))) {
      const f = tf.get(term);
      if (!f) continue;
      const df = this.docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.lengths[doc]) / this.avgLength));
    }
    return score;
  }
}
