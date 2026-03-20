import KanbanCard, { type Person, type PersonAlert } from "./KanbanCard";

export interface StageConfig {
  key: string;
  label: string;
  color: string;
}

interface KanbanColumnProps {
  stage: StageConfig;
  people: Person[];
  alerts: Record<string, PersonAlert>;
  visibleCount: number;
  selectedPersonId: string | null;
  onSelectPerson: (person: Person) => void;
}

export default function KanbanColumn({
  stage,
  people,
  alerts,
  visibleCount,
  selectedPersonId,
  onSelectPerson,
}: KanbanColumnProps) {
  const alertCount = people.filter((p) => alerts[p.id]).length;

  // Sort: people with alerts first, then alphabetical
  const sorted = [...people].sort((a, b) => {
    const aAlert = alerts[a.id] ? 0 : 1;
    const bAlert = alerts[b.id] ? 0 : 1;
    if (aAlert !== bAlert) return aAlert - bAlert;
    return (a.firstName || "").localeCompare(b.firstName || "");
  });

  const visible = sorted.slice(0, visibleCount);

  return (
    <div className="flex flex-col min-w-[250px] w-[250px] shrink-0">
      {/* Column header */}
      <div className="flex items-center gap-2 px-2 py-2 mb-2">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
        <span className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">
          {stage.label}
        </span>
        {alertCount > 0 && (
          <span className="text-[10px] bg-orange-400/20 text-orange-400 px-1.5 py-0.5 rounded-full font-medium">
            {alertCount}
          </span>
        )}
        <span className="text-xs text-[var(--text-tertiary)] ml-auto">{people.length}</span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 px-1 pb-2 overflow-y-auto flex-1 min-h-0">
        {visible.map((person) => (
          <KanbanCard
            key={person.id}
            person={person}
            alert={alerts[person.id]}
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
