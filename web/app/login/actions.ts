"use server";

import { signIn } from "@/lib/auth";
import { isMobilePublicUiMode } from "@/lib/backend-only-ui";

export async function credentialsSignIn() {
  await signIn("credentials", {
    redirectTo: isMobilePublicUiMode() ? "/m/suzi" : "/",
  });
}
