/**
 * Knowledge Studio topic slugs shared by server (marni-kb) and client (Knowledge panel).
 * Keep in sync with ensureTim* helpers in marni-kb.ts.
 */
export const TIM_CRM_CORPUS_SLUG = "crm-linkedin-corpus";

export const TIM_PDF_CORPUS_SLUG = "tim-reference-pdfs";

export function isTimProtectedKbTopicSlug(slug: string): boolean {
  return slug === TIM_CRM_CORPUS_SLUG || slug === TIM_PDF_CORPUS_SLUG;
}
