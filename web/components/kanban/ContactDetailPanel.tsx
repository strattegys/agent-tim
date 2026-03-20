import { useState, useEffect, useCallback } from "react";
import type { Person } from "./KanbanCard";

interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

interface ContactDetailPanelProps {
  person: Person;
  onClose: () => void;
}

export default function ContactDetailPanel({ person, onClose }: ContactDetailPanelProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);

  const fullName = [person.firstName, person.lastName].filter(Boolean).join(" ") || "Unknown";

  const fetchNotes = useCallback(() => {
    setLoadingNotes(true);
    fetch(`/api/crm/notes?personId=${person.id}`)
      .then((r) => r.json())
      .then((data) => setNotes(data.notes || []))
      .catch(() => setNotes([]))
      .finally(() => setLoadingNotes(false));
  }, [person.id]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleSubmitNote = async () => {
    if (!noteText.trim() || saving) return;
    setSaving(true);
    try {
      await fetch("/api/crm/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: person.id,
          title: "Web Note from Govind",
          body: noteText.trim(),
        }),
      });
      setNoteText("");
      fetchNotes();
    } catch {
      // Silently fail — user sees note didn't appear
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[380px] bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col z-50 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">{fullName}</h2>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Contact info */}
      <div className="p-4 border-b border-[var(--border-color)] space-y-2">
        {person.jobTitle && (
          <InfoRow label="Title" value={person.jobTitle} />
        )}
        {person.companyName && (
          <InfoRow label="Company" value={person.companyName} />
        )}
        {person.email && (
          <InfoRow label="Email" value={person.email} />
        )}
        {person.city && (
          <InfoRow label="City" value={person.city} />
        )}
        {person.linkedinUrl && (
          <div className="flex gap-2 text-xs">
            <span className="text-[var(--text-tertiary)] w-16 shrink-0">LinkedIn</span>
            <a
              href={person.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent-blue)] hover:underline truncate"
            >
              Profile
            </a>
          </div>
        )}
        <div className="flex gap-2 text-xs">
          <span className="text-[var(--text-tertiary)] w-16 shrink-0">Stage</span>
          <span className="text-[var(--text-primary)] font-medium">{person.stage}</span>
        </div>
      </div>

      {/* Add note section */}
      <div className="p-4 border-b border-[var(--border-color)]">
        <label className="text-xs text-[var(--text-secondary)] font-medium block mb-2">
          Add note for Tim
        </label>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Write a note for Tim to act on..."
          rows={3}
          className="w-full bg-[var(--bg-input)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2 border border-[var(--border-color)] outline-none resize-none placeholder-[var(--text-tertiary)]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSubmitNote();
            }
          }}
        />
        <button
          onClick={handleSubmitNote}
          disabled={!noteText.trim() || saving}
          className="mt-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--accent-green)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {saving ? "Saving..." : "Save Note"}
        </button>
      </div>

      {/* Notes history */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <h3 className="text-xs text-[var(--text-secondary)] font-medium mb-3">
          Notes ({notes.length})
        </h3>
        {loadingNotes ? (
          <div className="text-xs text-[var(--text-tertiary)] text-center py-4">Loading notes...</div>
        ) : notes.length === 0 ? (
          <div className="text-xs text-[var(--text-tertiary)] text-center py-4 italic">No notes yet</div>
        ) : (
          <div className="space-y-3">
            {notes.map((note) => (
              <div
                key={note.id}
                className="p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)]"
              >
                {note.title && (
                  <div className="text-xs font-medium text-[var(--text-primary)] mb-1">
                    {note.title}
                  </div>
                )}
                <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap break-words">
                  {note.body}
                </div>
                {note.createdAt && (
                  <div className="text-[10px] text-[var(--text-tertiary)] mt-2">
                    {formatDate(note.createdAt)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-[var(--text-tertiary)] w-16 shrink-0">{label}</span>
      <span className="text-[var(--text-primary)] truncate">{value}</span>
    </div>
  );
}
