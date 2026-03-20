"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import KanbanBoard from "@/components/kanban/KanbanBoard";
import CampaignSelector from "@/components/kanban/CampaignSelector";
import ContactDetailPanel from "@/components/kanban/ContactDetailPanel";
import type { Person } from "@/components/kanban/KanbanCard";

export default function KanbanPage() {
  const [campaignId, setCampaignId] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPeople = useCallback(async (id: string) => {
    if (!id) {
      setPeople([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/people?campaignId=${id}`);
      const data = await res.json();
      setPeople(data.people || []);
    } catch {
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelectedPerson(null);
    fetchPeople(campaignId);
  }, [campaignId, fetchPeople]);

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)]">
      {/* Top bar */}
      <div className="h-12 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-4 gap-3">
        <Link
          href="/chat"
          className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
          title="Back to Chat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </Link>

        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Pipeline</h1>

        <CampaignSelector selectedId={campaignId} onSelect={setCampaignId} />

        {loading && (
          <span className="text-xs text-[var(--text-tertiary)]">Loading...</span>
        )}

        <span className="ml-auto text-xs text-[var(--text-tertiary)]">
          {people.length > 0 && `${people.length} contacts`}
        </span>
      </div>

      {/* Board */}
      {!campaignId ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[var(--text-tertiary)]">Select a campaign to view the pipeline</p>
        </div>
      ) : people.length === 0 && !loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[var(--text-tertiary)]">No contacts in this campaign</p>
        </div>
      ) : (
        <KanbanBoard
          people={people}
          selectedPersonId={selectedPerson?.id ?? null}
          onSelectPerson={setSelectedPerson}
        />
      )}

      {/* Detail panel */}
      {selectedPerson && (
        <ContactDetailPanel
          person={selectedPerson}
          onClose={() => setSelectedPerson(null)}
        />
      )}
    </div>
  );
}
