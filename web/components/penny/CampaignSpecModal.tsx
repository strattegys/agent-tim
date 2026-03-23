"use client";

import { useState, useEffect, useRef } from "react";

interface CampaignSpecModalProps {
  packageId: string;
  packageName: string;
  initialSpec: string;
  onClose: () => void;
  onSave: (spec: string) => void;
}

export default function CampaignSpecModal({
  packageId,
  packageName,
  initialSpec,
  onClose,
  onSave,
}: CampaignSpecModalProps) {
  const [text, setText] = useState(initialSpec);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/crm/packages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: packageId,
          spec: { brief: text },
        }),
      });
      if (res.ok) {
        onSave(text);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = text !== initialSpec;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative w-[90vw] max-w-[800px] h-[80vh] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Campaign Specification
            </h2>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
              {packageName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors p-1"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Help text */}
        <div className="shrink-0 px-5 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
            Paste the campaign specification here. Include product info, messaging guidelines,
            target audience, tone, and any details agents need when executing this package.
          </p>
        </div>

        {/* Textarea */}
        <div className="flex-1 min-h-0 p-4">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste campaign specification here...&#10;&#10;Example:&#10;Product: CloudSync Pro — B2B SaaS for automated data pipelines&#10;Target: CTOs and VPs of Engineering at mid-market companies (200-2000 employees)&#10;Key messaging: &quot;Stop managing pipelines, start managing growth.&quot;&#10;Tone: Professional but approachable. Avoid heavy jargon.&#10;Competitors to reference: Fivetran, Airbyte&#10;Key differentiators: 60% faster setup, no-code interface"
            className="w-full h-full resize-none bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-4 text-sm text-[var(--text-primary)] leading-relaxed focus:outline-none focus:border-[#E67E22]/50 placeholder:text-[var(--text-tertiary)]/50"
            style={{ fontFamily: "inherit" }}
          />
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center justify-between">
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {text.length > 0 ? `${text.length} characters` : "Empty"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="text-xs px-4 py-1.5 rounded font-semibold text-white transition-colors disabled:opacity-40"
              style={{ backgroundColor: "#E67E22" }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
