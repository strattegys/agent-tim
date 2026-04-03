/** Shared types for GET /api/penny/accounts and Penny workspace UI. */

export type PennyDerivedStage = "lead" | "proposal" | "review" | "customer" | "delivered";

export type PennyAccountDto = {
  id: string;
  name: string;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  contactCount: number;
  activePackages: number;
  draftPackages: number;
  pendingPackages: number;
  completedPackages: number;
  totalPackages: number;
  derivedStage: PennyDerivedStage;
};

export type PennyAccountsResponse = {
  accounts: PennyAccountDto[];
  note?: string;
};
