"use client";

import { useState, useEffect, useCallback } from "react";

interface SystemPromptEditorProps {
  agentId: string;
  agentName: string;
  onClose: () => void;
}

export default function SystemPromptEditor({
  agentId,
  agentName,
  onClose,
}: SystemPromptEditorProps) {
  const [prompt, setPrompt] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/system-prompt?agent=${agentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.prompt) {
          setPrompt(data.prompt);
          setOriginal(data.prompt);
        }
      })
      .catch(() => setStatus("error"))
      .finally(() => setLoading(false));
  }, [agentId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setStatus("idle");
    try {
      const res = await fetch("/api/system-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: agentId, prompt }),
      });
      if (res.ok) {
        setOriginal(prompt);
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 2000);
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }, [agentId, prompt]);

  const hasChanges = prompt !== original;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <div>
            <div className="text-sm font-medium">{agentName} — System Prompt</div>
            <div className="text-xs text-[var(--text-secondary)]">
              Changes take effect on the next message
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-lg px-2"
          >
            &times;
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
              Loading...
            </div>
          ) : (
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-full bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm font-mono rounded-lg p-3 resize-none outline-none border border-[var(--border-color)] focus:border-[var(--accent-green)]"
              style={{ minHeight: "300px" }}
              spellCheck={false}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-color)]">
          <div className="text-xs">
            {status === "saved" && (
              <span className="text-[var(--accent-green)]">Saved</span>
            )}
            {status === "error" && (
              <span className="text-red-400">Failed to save</span>
            )}
            {status === "idle" && hasChanges && (
              <span className="text-[var(--text-secondary)]">Unsaved changes</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="px-3 py-1.5 text-sm rounded-lg bg-[var(--accent-green)] text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
