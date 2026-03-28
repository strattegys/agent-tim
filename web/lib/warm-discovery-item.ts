/**
 * Warm-outreach discovery slots: `_workflow_item` rows that are not yet tied to a CRM `person`.
 * `sourceId` is an opaque UUID (no FK to `person`) until Govind submits intake; then resolve links
 * `sourceType` → `person` and `sourceId` → real contact id.
 */
export const WARM_DISCOVERY_SOURCE_TYPE = "warm_discovery" as const;
