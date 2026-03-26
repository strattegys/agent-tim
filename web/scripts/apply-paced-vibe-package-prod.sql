-- One-shot: merge paced warmOutreachDiscovery for vibe-coding-outreach packages.
-- Run on host: cat this file | docker compose ... exec -T crm-db psql -U postgres -d default -v ON_ERROR_STOP=1

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

UPDATE "_package"
SET
  spec = jsonb_set(
    COALESCE(spec, '{}'::jsonb),
    '{warmOutreachDiscovery}',
    COALESCE(spec->'warmOutreachDiscovery', '{}'::jsonb)
      || jsonb_build_object(
        'pacedDaily', true,
        'discoveriesPerDay', 5,
        'bootstrapStartMinutesPt', 510,
        'postIntakeDelayMinMinutes', 30,
        'postIntakeDelayMaxMinutes', 40,
        'maxOpenDiscoverySlots', 1
      ),
    true
  ),
  "updatedAt" = NOW()
WHERE "deletedAt" IS NULL
  AND "templateId" = 'vibe-coding-outreach';
