import { execFileSync } from "child_process";
import { join } from "path";
import type { ToolModule, ToolContext } from "./types";
import { TOOL_SCRIPTS_PATH, TOOL_TIMEOUT, getToolEnv } from "./shared";

const tool: ToolModule = {
  metadata: {
    id: "twenty_crm",
    displayName: "Twenty CRM",
    category: "external",
    description:
      "Search, create, and update contacts, companies, notes, and workflows in the CRM database",
    externalSystem: "Twenty CRM (localhost:3000)",
    operations: [
      "list-contacts",
      "search-contacts",
      "get-contact",
      "create-contact",
      "update-contact",
      "write-note",
      "search-companies",
      "create-company",
      "get-company",
      "list-campaigns",
      "get-campaign",
      "get-campaign-spec",
      "update-campaign-spec",
      "create-campaign",
      "add-to-campaign",
      "remove-from-campaign",
      "get-campaign-context",
      "list-campaign-members",
    ],
    requiresApproval: false,
  },

  declaration: {
    name: "twenty_crm",
    description:
      "Execute a Twenty CRM operation. IMPORTANT: To search for a person, use command='search-contacts' (not search-people). For create-contact, use flat JSON fields like {\"firstName\":\"John\",\"lastName\":\"Doe\",\"jobTitle\":\"CEO\",\"email\":\"j@co.com\",\"linkedinUrl\":\"https://linkedin.com/in/slug\",\"companyId\":\"uuid\"} — the tool auto-wraps into Twenty's composite format. For write-note, arg1=title, arg2=markdown content (supports full markdown). Workflow commands (server still uses 'campaign' naming) use a dedicated Workflow object with inline spec field. Available commands: list-contacts, search-contacts, get-contact, create-contact, update-contact, write-note, search-companies, create-company, get-company, list-campaigns, get-campaign, get-campaign-spec, update-campaign-spec, create-campaign, add-to-campaign, remove-from-campaign, get-campaign-context, list-campaign-members.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command to run. Key commands: search-contacts (find people by name), create-contact (accepts flat JSON with firstName, lastName, jobTitle, email, linkedinUrl, companyId), write-note (arg1=title, arg2=content, optionally arg1=title arg2=content for linked notes use the format: 'title' 'content' 'targetType' 'targetId'), search-companies, create-company, list-campaigns, get-campaign, get-campaign-spec (read spec), update-campaign-spec (arg1=campaign_id, arg2=new_spec), create-campaign (arg1=name, arg2=spec), add-to-campaign.",
        },
        arg1: {
          type: "string",
          description:
            "First argument: query string for search, JSON payload for create-contact/create-company, title for write-note, or record ID for get/update",
        },
        arg2: {
          type: "string",
          description:
            "Second argument: JSON payload for update, markdown content for write-note",
        },
        arg3: {
          type: "string",
          description:
            "Third argument: for write-note linked to a record, the target type (person or company)",
        },
        arg4: {
          type: "string",
          description:
            "Fourth argument: for write-note linked to a record, the target record ID",
        },
      },
      required: ["command"],
    },
  },

  async execute(args: Record<string, string>) {
    const cmdArgs = [args.command, args.arg1, args.arg2, args.arg3, args.arg4].filter(Boolean);
    return execFileSync(join(TOOL_SCRIPTS_PATH, "crm.sh"), cmdArgs, {
      timeout: TOOL_TIMEOUT,
      env: getToolEnv(),
      encoding: "utf-8",
    });
  },
};

export default tool;
