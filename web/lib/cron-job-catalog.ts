/**
 * Static cron job catalog for `/api/cron-status`, Friday Cron tab, and architecture diagrams.
 * Shared with scripts — keep free of server-only side effects.
 */

import { AGENT_REGISTRY } from "./agent-registry";

/** Who mainly benefits from the job (Friday Cron tab), not necessarily the owning agent. */
const CRON_JOB_BENEFICIARIES: Record<string, readonly string[]> = {
  "linkedin-connections": ["tim"],
  "warm-outreach-discovery": ["tim"],
  "daily-target-research": ["tim"],
  "heartbeat-friday": ["tim"],
  "marni-kb-cadence": ["marni", "tim"],
  "unipile-webhook-inbox-drain": ["tim"],
  "linkedin-inbound-catchup": ["tim"],
  "anthropic-cost-sync": ["penny"],
};

export function beneficiaryAgentIdsFor(jobId: string): string[] {
  return [...(CRON_JOB_BENEFICIARIES[jobId] ?? [])];
}

export type CronJobListSeed = {
  id: string;
  name: string;
  schedule: string;
  description: string;
  logFile: string | null;
  agentId: string;
  enabled: boolean;
  timeZone: string | null;
  beneficiaryAgentIds: string[];
};

export function getCronJobSeedMetadata(): CronJobListSeed[] {
  const rows: CronJobListSeed[] = [];

  for (const spec of Object.values(AGENT_REGISTRY)) {
    for (const routine of spec.routines) {
      rows.push({
        id: routine.id,
        name: routine.name,
        schedule: routine.schedule,
        description: routine.description,
        logFile: routine.logFile ?? null,
        agentId: spec.id,
        enabled: routine.enabled !== false,
        timeZone: routine.timeZone ?? null,
        beneficiaryAgentIds: beneficiaryAgentIdsFor(routine.id),
      });
    }
    if (spec.heartbeat) {
      const hbId = `heartbeat-${spec.id}`;
      rows.push({
        id: hbId,
        name: "Heartbeat",
        schedule: spec.heartbeat.schedule,
        description: spec.heartbeat.checks.map((c) => c.name).join(", "),
        logFile: null,
        agentId: spec.id,
        enabled: true,
        timeZone: null,
        beneficiaryAgentIds: beneficiaryAgentIdsFor(hbId),
      });
    }
  }

  rows.push(
    {
      id: "holiday-sync",
      name: "Holiday Sync",
      schedule: "17 3 1 * *",
      description: "Sync US holidays from Nager.Date API into reminders",
      logFile: null,
      agentId: "friday",
      enabled: true,
      timeZone: null,
      beneficiaryAgentIds: beneficiaryAgentIdsFor("holiday-sync"),
    },
    {
      id: "unipile-webhook-inbox-drain",
      name: "Drain Unipile webhook inbox",
      schedule: "* * * * *",
      description:
        "Process persisted Unipile POST payloads (fault-tolerant queue when app restarts or CRM was down)",
      logFile: null,
      agentId: "friday",
      enabled: true,
      timeZone: null,
      beneficiaryAgentIds: beneficiaryAgentIdsFor("unipile-webhook-inbox-drain"),
    },
    {
      id: "linkedin-inbound-catchup",
      name: "LinkedIn inbound Unipile catch-up",
      schedule: "*/10 * * * *",
      description:
        "Drain webhook inbox batch; release stuck dedupe receipts; replay Unipile DMs (lookback hours from LINKEDIN_INBOUND_CATCHUP_HOURS, default 72)",
      logFile: null,
      agentId: "friday",
      enabled: true,
      timeZone: null,
      beneficiaryAgentIds: beneficiaryAgentIdsFor("linkedin-inbound-catchup"),
    }
  );

  rows.push({
    id: "anthropic-cost-sync",
    name: "Anthropic admin cost sync",
    schedule: "0 6 * * 0",
    description:
      "Pull Anthropic organization cost_report into _usage_event (weekly, UTC). Requires ANTHROPIC_ADMIN_API_KEY; no-ops if unset. Use pause to turn off.",
    logFile: null,
    agentId: "friday",
    enabled: true,
    timeZone: null,
    beneficiaryAgentIds: beneficiaryAgentIdsFor("anthropic-cost-sync"),
  });

  return rows;
}
