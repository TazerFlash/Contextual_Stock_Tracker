// Turns an SEC inline-XBRL filing (HTML) into plain paragraphs suitable for chunking.

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", bull: "•", hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

// Share of digits above which a table is treated as financial data rather than layout.
const NUMERIC_TABLE_DIGIT_SHARE = 0.15;

/**
 * Financial tables lose their column headers once flattened ("Gross margin 75.0 % 74.9 % 72.4 %"),
 * and a small model can't tell which period a number belongs to. The same figures are stated in the
 * MD&A prose, so number-heavy tables are dropped; layout tables that wrap prose are kept.
 */
function dropNumericTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
    const text = decodeEntities(table.replace(/<[^>]+>/g, " ")).replace(/\s+/g, "");
    const digits = text.match(/\d/g)?.length ?? 0;
    return text.length && digits / text.length > NUMERIC_TABLE_DIGIT_SHARE ? " " : table;
  });
}

/**
 * Drops running page headers/footers: short lines that repeat many times in one document
 * ("Table of Contents", "NVIDIA Corporation and Subsidiaries", "(Unaudited)").
 */
export function removeRepeatedLines(text: string, minRepeats = 5, maxLength = 120): string {
  const counts = new Map<string, number>();
  const lines = text.split("\n");
  for (const line of lines) if (line && line.length <= maxLength) counts.set(line, (counts.get(line) ?? 0) + 1);
  return lines
    .filter((line) => !line || line.length > maxLength || (counts.get(line) ?? 0) < minRepeats)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function htmlToText(html: string): string {
  const text = decodeEntities(
    dropNumericTables(
      html
        .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ") // hidden XBRL metadata
        .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " "),
    )
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n\n")
      .replace(/<\/t[dh]>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  );

  return removeRepeatedLines(text
    .split("\n")
    .map((line) => line.replace(/[ \t ​]+/g, " ").trim())
    // Keep blank lines (paragraph breaks); drop page numbers and number-only table rows.
    .filter((line) => line === "" || (line.match(/[a-z]/gi)?.length ?? 0) >= 3)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()).trim();
}
