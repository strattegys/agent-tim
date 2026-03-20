import KanbanCard, { type Person } from "./KanbanCard";

export interface StageConfig {
  key: string;
  label: string;
  color: string;
}

interface KanbanColumnProps {
  stage: StageConfig;
  people: Person[];
  selectedPersonId: string | null;
  onSelectPerson: (person: Person) => void;
}

export default function KanbanColumn({
  stage,
  people,
  selectedPersonId,
  onSelectPerson,
}: KanbanColumnProps) {
  return (
    <div className="flex flex-col min-w-[250px] w-[250px] shrink-0">
      {/* Column header */}
      <div className="flex items-center gap-2 px-2 py-2 mb-2">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
        <span className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">
          {stage.label}
        </span>
        <span className="text-xs text-[var(--text-tertiary)] ml-auto">{people.length}</span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 px-1 pb-4 overflow-y-auto flex-1 min-h-0">
        {people.map((person) => (
          <KanbanCard
            key={person.id}
            person={person}
            isSelected={person.id === selectedPersonId}
            onClick={() => onSelectPerson(person)}
          />
        ))}
        {people.length === 0 && (
          <div className="text-xs text-[var(--text-tertiary)] text-center py-4 italic">
            No contacts
          </div>
        )}
      </div>
    </div>
  );
}
