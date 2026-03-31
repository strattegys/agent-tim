"use client";

import { useEffect, useState } from "react";
import { panelBus } from "@/lib/events";

interface IntakeAddModalProps {
  open: boolean;
  onClose: () => void;
}

export default function IntakeAddModal({ open, onClose }: IntakeAddModalProps) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setUrl("");
      setBody("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const submit = async () => {
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "add",
          title: t,
          url: url.trim() || undefined,
          body: body.trim() || undefined,
          source: "ui",
        }),
      });
      if (res.ok) {
        panelBus.emit("intake", { focusNewest: true });
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="intake-add-title"
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" aria-hidden onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl p-4 space-y-3 max-h-[min(90vh,32rem)] flex flex-col">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <h2 id="intake-add-title" className="text-sm font-semibold text-[var(--text-primary)]">
            Add To Intake
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-2 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Close
          </button>
        </div>
        <div className="space-y-2 overflow-y-auto min-h-0 flex-1">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title *"
            className="w-full text-sm px-2.5 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
            autoFocus
          />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL (optional)"
            className="w-full text-sm px-2.5 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Note / snippet (optional)"
            rows={4}
            className="w-full text-sm px-2.5 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)] resize-none leading-relaxed"
          />
        </div>
        <div className="flex justify-end gap-2 shrink-0 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !title.trim()}
            className="text-xs px-3 py-1.5 rounded-lg bg-[#D85A30] text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
          >
            {saving ? "Saving…" : "Add To Intake"}
          </button>
        </div>
      </div>
    </div>
  );
}
