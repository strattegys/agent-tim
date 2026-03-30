import "server-only";

import pdfParse from "pdf-parse";

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
