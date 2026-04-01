import type { StageSpec } from "@/lib/workflow-types";

/**
 * For each gap between stage[i] and stage[i+1], whether to show a **loop** connector
 * (later stages transition back to an earlier one) vs a simple forward chevron.
 * Matches PackageDetailCard / DeliverableRow behavior.
 */
export function stageConnectorsAreLoopBack(
  stages: Pick<StageSpec, "key">[],
  transitions: Record<string, string[]>
): boolean[] {
  if (stages.length < 2) return [];
  const cycleArrowAfter = new Set<number>();
  stages.forEach((s, i) => {
    for (const t of transitions[s.key] || []) {
      const targetIdx = stages.findIndex((st) => st.key === t);
      if (targetIdx >= 0 && targetIdx < i) {
        cycleArrowAfter.add(targetIdx);
      }
    }
  });
  const out: boolean[] = [];
  for (let i = 0; i < stages.length - 1; i++) {
    out.push(cycleArrowAfter.has(i));
  }
  return out;
}
