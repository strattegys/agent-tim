import { redirectIfBackendOnlyUi } from "@/lib/main-ui-gate";
import KanbanBoardPageClient from "./KanbanBoardPageClient";

export const dynamic = "force-dynamic";

export default function KanbanPage() {
  redirectIfBackendOnlyUi();
  return <KanbanBoardPageClient />;
}
