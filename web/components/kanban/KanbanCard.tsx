export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  email: string;
  linkedinUrl: string;
  stage: string;
  city: string;
  companyName: string;
}

interface KanbanCardProps {
  person: Person;
  isSelected: boolean;
  onClick: () => void;
}

export default function KanbanCard({ person, isSelected, onClick }: KanbanCardProps) {
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ") || "Unknown";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
        isSelected
          ? "bg-[var(--bg-tertiary)] border-[var(--accent-blue)]"
          : "bg-[var(--bg-secondary)] border-[var(--border-color)] hover:border-[var(--text-tertiary)]"
      }`}
    >
      <div className="text-sm font-medium text-[var(--text-primary)] truncate">{name}</div>
      {person.jobTitle && (
        <div className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
          {person.jobTitle}
        </div>
      )}
      {person.companyName && (
        <div className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">
          {person.companyName}
        </div>
      )}
    </button>
  );
}
