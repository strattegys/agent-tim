"use client";

function isChunkLoadError(msg: string): boolean {
  return /loading chunk|chunkloaderror|chunk.*failed/i.test(msg);
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const msg = error.message || "Something went wrong while rendering this page.";
  const chunk = isChunkLoadError(msg);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#0a0f18] text-[#c5c8ce] p-6">
      <h1 className="text-lg font-semibold text-[#f5f5f5]">Command Central hit an error</h1>
      <p className="text-sm text-[#8b9199] max-w-md text-center">{msg}</p>
      {chunk ? (
        <p className="text-xs text-[#6b7280] max-w-md text-center leading-relaxed">
          Dev server may still be compiling the first time, or the browser cached a stale chunk. Stop dev, run{" "}
          <code className="text-[#9aa3ae]">npm run dev:clean</code> from <code className="text-[#9aa3ae]">web/</code>, wait
          until the terminal says Ready, then hard-refresh (Ctrl+Shift+R). Use <code className="text-[#9aa3ae]">npm run dev</code>{" "}
          (webpack); only use <code className="text-[#9aa3ae]">dev:turbo</code> if webpack misbehaves on your machine.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-[#2b5278] px-4 py-2 text-sm text-[#f5f5f5] hover:bg-[#3a6a96]"
        >
          Try again
        </button>
        {chunk ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-[#2a3a4a] px-4 py-2 text-sm text-[#c5c8ce] hover:bg-[#17212b]"
          >
            Reload page
          </button>
        ) : null}
      </div>
    </div>
  );
}
