import { redirect } from "next/navigation";
import { redirectIfBackendOnlyUi } from "@/lib/main-ui-gate";

export const dynamic = "force-dynamic";

export default async function ChatRedirect() {
  redirectIfBackendOnlyUi();
  redirect("/");
}
