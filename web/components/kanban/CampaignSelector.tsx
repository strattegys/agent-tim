import { useState, useEffect } from "react";

interface Campaign {
  id: string;
  name: string;
  stage: string;
}

interface CampaignSelectorProps {
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function CampaignSelector({ selectedId, onSelect }: CampaignSelectorProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/crm/campaigns")
      .then((r) => r.json())
      .then((data) => setCampaigns(data.campaigns || []))
      .catch(() => setCampaigns([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <select
      value={selectedId}
      onChange={(e) => onSelect(e.target.value)}
      disabled={loading}
      className="bg-[var(--bg-input)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-1.5 border border-[var(--border-color)] outline-none cursor-pointer min-w-[200px]"
    >
      <option value="">{loading ? "Loading campaigns..." : "Select a campaign"}</option>
      {campaigns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} ({c.stage})
        </option>
      ))}
    </select>
  );
}
