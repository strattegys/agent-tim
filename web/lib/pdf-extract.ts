import "server-only";

import { createRequire } from "node:module";
import path from "node:path";

// pdf-parse is CommonJS; default ESM import breaks Turbopack/webpack resolution in some builds.
const requirePdf = createRequire(path.join(process.cwd(), "package.json"));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-only dependency
const pdfParse = requirePdf("pdf-parse") as (buffer: Buffer) => Promise<{ text?: string }>;

/**
 * Extract plain text from a PDF buffer (first pass for Tim Knowledge ingestion).
 * Scanned/image PDFs may return little or no text.
 */
export async function extractTextFromPdfBuffer(buf: Buffer): Promise<string> {
  const data = await pdfParse(buf);
  return String(data.text ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}
