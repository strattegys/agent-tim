export interface StageConfig {
  key: string;
  label: string;
  color: string;
  /** From board JSON — stage needs a human before advancing */
  requiresHuman?: boolean;
  humanAction?: string;
}

export interface Board {
  id: string;
  name: string;
  description: string | null;
  stages: StageConfig[];
  transitions: Record<string, string[]>;
}

export type WorkflowItemType = "person" | "content";

export interface WorkflowWithBoard {
  id: string;
  name: string;
  stage: string; // workflow status: PLANNING | ACTIVE | PAUSED | COMPLETED
  spec: string;
  itemType: WorkflowItemType;
  boardId: string | null;
  board: Board | null;
  ownerAgent?: string | null;
  packageId?: string | null;
  /** Parent package name for grouped selectors */
  packageName?: string | null;
  /** Human-friendly package id for chat (“package #12”) */
  packageNumber?: number | null;
}

/** A single item on the kanban board, polymorphic via sourceType */
export interface WorkflowItem {
  id: string; // _workflow_item row ID
  workflowId: string;
  stage: string; // board stage key (TARGET, IDEA, etc.)
  sourceType: WorkflowItemType;
  sourceId: string;
  position: number;
  // Denormalized display fields populated by API join:
  title: string; // person: "First Last", content: title
  subtitle: string; // person: jobTitle, content: contentType
  extra: string; // person: companyName, content: url
  linkedinUrl?: string; // person only
  email?: string; // person only
  /** Persisted: item is in a human-required stage (work queue). */
  humanTaskOpen?: boolean;
}
