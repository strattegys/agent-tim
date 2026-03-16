import { signIn, auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/chat");

  return (
    <div className="h-screen flex items-center justify-center bg-[#0e1621]">
      <div className="text-center">
        <div className="mb-6">
          <div className="w-16 h-16 rounded-full bg-[#2b5278] mx-auto flex items-center justify-center mb-4">
            <span className="text-2xl font-bold text-white">T</span>
          </div>
          <h1 className="text-xl font-semibold text-[#f5f5f5]">Tim</h1>
          <p className="text-[13px] text-[#6b8a9e] mt-1">AI Assistant</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("credentials", { redirectTo: "/chat" });
          }}
        >
          <button
            type="submit"
            className="bg-[#2b5278] hover:bg-[#3a6a96] text-[#f5f5f5] text-[13px] px-6 py-2.5 rounded-lg transition-colors"
          >
            Enter Chat
          </button>
        </form>
      </div>
    </div>
  );
}
