"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RemindersRedirectClient() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/?agent=suzi&panel=reminders&suziSub=reminders");
  }, [router]);

  return null;
}
