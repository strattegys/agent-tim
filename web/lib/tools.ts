import { execFileSync } from "child_process";
import { join } from "path";
import { readMemory, appendMemoryFact, replaceMemory } from "./memory";
import { createTask } from "./tasks";
import {
  listReminders,
  getUpcomingReminders,
  addReminder,
  updateReminder,
  deleteReminder,
} from "./reminders";

const TOOL_SCRIPTS_PATH =
  process.env.TOOL_SCRIPTS_PATH || join(process.cwd(), "..", ".nanobot", "tools");
const TOOL_TIMEOUT = 15000;
const LINKEDIN_TIMEOUT = 60000;

export const toolDeclarations = [
  {
    name: "twenty_crm",
    description:
      "Execute a Twenty CRM operation. IMPORTANT: To search for a person, use command='search-contacts' (not search-people). For create-contact, use flat JSON fields like {\"firstName\":\"John\",\"lastName\":\"Doe\",\"jobTitle\":\"CEO\",\"email\":\"j@co.com\",\"linkedinUrl\":\"https://linkedin.com/in/slug\",\"companyId\":\"uuid\"} — the tool auto-wraps into Twenty's composite format. For write-note, arg1=title, arg2=markdown content (supports full markdown). Workflow commands use a dedicated Workflow object (formerly Campaign) with inline spec field. Available commands: list-contacts, search-contacts, get-contact, create-contact, update-contact, write-note, search-companies, create-company, get-company, list-campaigns, get-campaign, get-campaign-spec, update-campaign-spec, create-campaign, add-to-campaign, remove-from-campaign, get-campaign-context, list-campaign-members.",
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
          description: "First argument: query string for search, JSON payload for create-contact/create-company, title for write-note, or record ID for get/update",
        },
        arg2: {
          type: "string",
          description: "Second argument: JSON payload for update, markdown content for write-note",
        },
        arg3: {
          type: "string",
          description: "Third argument: for write-note linked to a record, the target type (person or company)",
        },
        arg4: {
          type: "string",
          description: "Fourth argument: for write-note linked to a record, the target record ID",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "linkedin",
    description: "Execute a LinkedIn operation via Unipile API. IMPORTANT: ONLY use send-message or send-connection when the user explicitly says 'send it now'. NEVER send messages without explicit approval. For send-message, use the ACoAAA provider ID from the contact's LinkedIn URL in the CRM — vanity slugs may not work for all profiles.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command: fetch-profile, send-message, recent-messages, send-connection, account-info, get-chat-messages",
        },
        arg1: {
          type: "string",
          description: "First argument: LinkedIn provider ID (ACoAAA...), vanity slug (e.g. 'rajat-gupta-104391'), or full LinkedIn URL. For send-message, prefer the ACoAAA ID from the CRM contact's linkedinLink.",
        },
        arg2: {
          type: "string",
          description: "Second argument (message text for send-message, or connection note for send-connection)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "schedule_message",
    description:
      "Schedule a LinkedIn message to be sent at a future time. IMPORTANT: ONLY use this tool when the user explicitly says 'schedule it now' or 'send it now'. NEVER schedule or send a message without explicit user approval. Commands: schedule, list, cancel.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command: 'schedule' to queue a message, 'list' to show pending messages, 'cancel' to cancel a scheduled message.",
        },
        recipient_slug: {
          type: "string",
          description: "LinkedIn vanity slug of the recipient (for schedule command)",
        },
        recipient_name: {
          type: "string",
          description: "Display name of the recipient (for schedule command)",
        },
        message: {
          type: "string",
          description: "The message text to send (for schedule command)",
        },
        send_at: {
          type: "string",
          description:
            "ISO 8601 datetime when to send, e.g. '2026-03-17T10:07:00-07:00'. ALWAYS use US Pacific time (America/Los_Angeles).",
        },
        message_id: {
          type: "string",
          description: "Message ID to cancel (for cancel command)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "web_search",
    description: "Search the web using Brave Search API.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory",
    description:
      "Manage your long-term memory. Use this to remember important facts, user preferences, and context across conversations. Commands: 'read' to view current memory, 'save_fact' to add a single fact, 'replace' to rewrite entire memory. You SHOULD proactively save important facts when you learn them (names, preferences, decisions, project context).",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command: 'read' to see current memory, 'save_fact' to add a fact, 'replace' to rewrite all memory",
        },
        content: {
          type: "string",
          description:
            "For save_fact: the fact to remember. For replace: the full new memory content.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "reminders",
    description:
      "Manage reminders and important dates. Use this to track birthdays, holidays, recurring events, one-time tasks, and important facts. Commands: 'list' (optional category filter), 'search' (find by keyword), 'add' (create new), 'update' (modify existing), 'delete' (remove), 'upcoming' (next 10 due). Categories: birthday, holiday, recurring, one-time, fact. Recurrence: yearly, monthly, weekly, daily.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "list, search, add, update, delete, or upcoming",
        },
        title: {
          type: "string",
          description: "Reminder title (for add/update)",
        },
        description: {
          type: "string",
          description: "Optional details (for add/update)",
        },
        category: {
          type: "string",
          description:
            "birthday, holiday, recurring, one-time, or fact (for add/update/list filter)",
        },
        date: {
          type: "string",
          description:
            "ISO date/datetime for when it's due, e.g. 2026-12-25 or 2026-03-21T14:00:00-07:00 (for add/update)",
        },
        recurrence: {
          type: "string",
          description: "yearly, monthly, weekly, daily — omit for one-time (for add/update)",
        },
        advance_days: {
          type: "string",
          description: "Days before the date to start reminding, default 0 (for add/update)",
        },
        query: {
          type: "string",
          description: "Search term (for search command)",
        },
        id: {
          type: "string",
          description: "Reminder UUID (for update/delete)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "agent_manager",
    description:
      "Manage agents in the Strattegys Command Central system. Create new agents, read/update system prompts, check agent status, and restart services. Use create-agent to provision server directories and system prompt for a new agent. After create-agent, the agent must still be registered in the codebase configs (agent-config.ts, config.ts) and deployed — tell the user to do this via Claude Code. Available commands: list-agents, get-agent-config, read-prompt, update-prompt, create-agent, restart-agent, agent-status.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "Command: list-agents (no args), get-agent-config <agent_id>, read-prompt <agent_id>, update-prompt <agent_id> <prompt_text>, create-agent <agent_id> <prompt_text>, restart-agent <agent_id>, agent-status <agent_id>",
        },
        arg1: {
          type: "string",
          description: "First argument: agent_id (e.g. 'scout', 'nova')",
        },
        arg2: {
          type: "string",
          description: "Second argument: system prompt text (for create-agent or update-prompt)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "delegate_task",
    description:
      "Delegate a task to another agent. Use this when you need research, analysis, or other work done by a specialist agent. The 'scout' agent can do web research, company intel, and contact discovery. Use urgency='sync' to wait for the result immediately, or 'async' to queue it for background processing.",
    parameters: {
      type: "object" as const,
      properties: {
        agent: {
          type: "string",
          description:
            "Target agent ID to delegate to (e.g., 'scout')",
        },
        task: {
          type: "string",
          description:
            "Detailed task description. Be specific about what information you need.",
        },
        urgency: {
          type: "string",
          description:
            "'sync' to wait for the result now (use when user is waiting), or 'async' to queue for background processing (use for non-urgent research)",
        },
      },
      required: ["agent", "task", "urgency"],
    },
  },
  {
    name: "workflow_manager",
    description:
      "Manage workflows and workflow templates across all agents. Use this to oversee, create, and modify workflows. Commands: list-workflows (optional arg1=agentId to filter by owner), get-workflow (arg1=workflowId), create-workflow (arg1=name, arg2=boardId, arg3=ownerAgent, arg4=itemType), update-workflow-stage (arg1=workflowId, arg2=new stage: PLANNING|ACTIVE|PAUSED|COMPLETED), assign-workflow (arg1=workflowId, arg2=agentId), list-boards, list-templates.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "Command: list-workflows, get-workflow, create-workflow, update-workflow-stage, assign-workflow, list-boards, list-templates",
        },
        arg1: {
          type: "string",
          description:
            "First arg: agentId (list-workflows filter), workflowId (get/update/assign), or name (create)",
        },
        arg2: {
          type: "string",
          description:
            "Second arg: boardId (create), new stage (update-workflow-stage), or agentId (assign-workflow)",
        },
        arg3: {
          type: "string",
          description: "Third arg: ownerAgent (create-workflow)",
        },
        arg4: {
          type: "string",
          description:
            "Fourth arg: itemType — 'person' or 'content' (create-workflow)",
        },
      },
      required: ["command"],
    },
  },
];

function getToolEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TWENTY_CRM_API_KEY: process.env.TWENTY_CRM_API_KEY,
    TWENTY_CRM_URL: process.env.TWENTY_CRM_URL || "http://localhost:3000",
    CONNECTSAFELY_API_KEY: process.env.CONNECTSAFELY_API_KEY,
    CONNECTSAFELY_ACCOUNT_ID: process.env.CONNECTSAFELY_ACCOUNT_ID,
    BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
  };
}

export const APPROVAL_PHRASES = [
  "send it now",
  "schedule it now",
  "go ahead and send",
  "go ahead and schedule",
];

function hasUserApproval(lastUserMessage: string): boolean {
  const lower = lastUserMessage.toLowerCase();
  return APPROVAL_PHRASES.some((phrase) => lower.includes(phrase));
}

export async function executeTool(
  name: string,
  args: Record<string, string>,
  lastUserMessage = "",
  agentId = "tim"
): Promise<string> {
  try {
    if (name === "memory") {
      const cmd = args.command;
      if (cmd === "read") {
        const mem = readMemory(agentId);
        return mem || "(No memories saved yet)";
      }
      if (cmd === "save_fact") {
        if (!args.content) return "Error: content is required for save_fact";
        appendMemoryFact(agentId, args.content);
        return `Saved to memory: ${args.content}`;
      }
      if (cmd === "replace") {
        replaceMemory(agentId, args.content || "");
        return "Memory replaced successfully";
      }
      return "Unknown memory command. Use: read, save_fact, replace";
    }

    if (name === "twenty_crm") {
      const cmdArgs = [args.command, args.arg1, args.arg2, args.arg3, args.arg4].filter(Boolean);
      return execFileSync(join(TOOL_SCRIPTS_PATH, "crm.sh"), cmdArgs, {
        timeout: TOOL_TIMEOUT,
        env: getToolEnv(),
        encoding: "utf-8",
      });
    }

    if (name === "linkedin") {
      const dangerousCmds = ["send-message", "send-connection"];
      if (dangerousCmds.includes(args.command) && !hasUserApproval(lastUserMessage)) {
        return "BLOCKED: Cannot send messages without explicit user approval. The user must say 'send it now' before you can send. Present your draft and wait for approval.";
      }
      const cmdArgs = [args.command, args.arg1, args.arg2].filter(Boolean);
      return execFileSync(join(TOOL_SCRIPTS_PATH, "linkedin.sh"), cmdArgs, {
        timeout: LINKEDIN_TIMEOUT,
        env: getToolEnv(),
        encoding: "utf-8",
      });
    }

    if (name === "schedule_message") {
      const cmd = args.command;
      if (cmd === "schedule") {
        if (!hasUserApproval(lastUserMessage)) {
          return "BLOCKED: Cannot schedule messages without explicit user approval. The user must say 'schedule it now' before you can schedule. Present your draft and wait for approval.";
        }
        const cmdArgs = [
          "schedule",
          args.recipient_slug,
          args.recipient_name,
          args.message,
          args.send_at,
        ].filter(Boolean);
        return execFileSync(
          "python3",
          [join(TOOL_SCRIPTS_PATH, "scheduled_messages.py"), ...cmdArgs],
          { timeout: TOOL_TIMEOUT, env: getToolEnv(), encoding: "utf-8" }
        );
      }
      if (cmd === "list") {
        return execFileSync(
          "python3",
          [join(TOOL_SCRIPTS_PATH, "scheduled_messages.py"), "list"],
          { timeout: TOOL_TIMEOUT, env: getToolEnv(), encoding: "utf-8" }
        );
      }
      if (cmd === "cancel") {
        return execFileSync(
          "python3",
          [join(TOOL_SCRIPTS_PATH, "scheduled_messages.py"), "cancel", args.message_id],
          { timeout: TOOL_TIMEOUT, env: getToolEnv(), encoding: "utf-8" }
        );
      }
      return "Unknown schedule_message command. Use: schedule, list, cancel";
    }

    if (name === "web_search") {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY;
      if (!apiKey) return "Web search not configured";

      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=5`;
      // Use sync fetch via execFileSync curl
      const result = execFileSync(
        "curl",
        ["-s", "-H", `X-Subscription-Token: ${apiKey}`, url],
        { timeout: TOOL_TIMEOUT, encoding: "utf-8" }
      );
      return result;
    }

    if (name === "reminders") {
      const cmd = args.command;
      if (cmd === "list") {
        const items = await listReminders(agentId, { category: args.category });
        if (items.length === 0) return "No reminders found.";
        return items
          .map(
            (r) =>
              `[${r.category}] ${r.title}${r.nextDueAt ? ` — due: ${new Date(r.nextDueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}${r.recurrence ? ` (${r.recurrence})` : ""}${r.description ? ` — ${r.description}` : ""} (id: ${r.id})`
          )
          .join("\n");
      }
      if (cmd === "search") {
        if (!args.query) return "Error: query is required for search";
        const items = await listReminders(agentId, { search: args.query });
        if (items.length === 0) return "No reminders matching that query.";
        return items
          .map(
            (r) =>
              `[${r.category}] ${r.title}${r.nextDueAt ? ` — due: ${new Date(r.nextDueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""} (id: ${r.id})`
          )
          .join("\n");
      }
      if (cmd === "add") {
        if (!args.title) return "Error: title is required";
        if (!args.category) return "Error: category is required (birthday, holiday, recurring, one-time, fact)";
        // Build recurrence anchor from the date
        let anchor: Record<string, number> | undefined;
        if (args.recurrence === "yearly" && args.date) {
          const d = new Date(args.date);
          anchor = { month: d.getMonth() + 1, day: d.getDate() };
        } else if (args.recurrence === "monthly" && args.date) {
          const d = new Date(args.date);
          anchor = { dayOfMonth: d.getDate() };
        } else if (args.recurrence === "weekly" && args.date) {
          const d = new Date(args.date);
          anchor = { dayOfWeek: d.getDay() };
        } else if (args.recurrence === "daily") {
          anchor = {};
        }
        const reminder = await addReminder(agentId, {
          category: args.category,
          title: args.title,
          description: args.description,
          nextDueAt: args.date || undefined,
          recurrence: args.recurrence,
          recurrenceAnchor: anchor,
          advanceNoticeDays: args.advance_days ? parseInt(args.advance_days) : 0,
        });
        return `Reminder created: "${reminder.title}" [${reminder.category}]${reminder.nextDueAt ? ` due ${new Date(reminder.nextDueAt).toLocaleDateString()}` : ""}${reminder.recurrence ? ` (${reminder.recurrence})` : ""} (id: ${reminder.id})`;
      }
      if (cmd === "update") {
        if (!args.id) return "Error: id is required for update";
        const updates: Record<string, unknown> = {};
        if (args.title) updates.title = args.title;
        if (args.description) updates.description = args.description;
        if (args.category) updates.category = args.category;
        if (args.date) updates.nextDueAt = args.date;
        if (args.recurrence) updates.recurrence = args.recurrence;
        if (args.advance_days) updates.advanceNoticeDays = parseInt(args.advance_days);
        await updateReminder(args.id, updates);
        return `Reminder ${args.id} updated successfully.`;
      }
      if (cmd === "delete") {
        if (!args.id) return "Error: id is required for delete";
        await deleteReminder(args.id);
        return `Reminder ${args.id} deleted.`;
      }
      if (cmd === "upcoming") {
        const items = await getUpcomingReminders(agentId);
        if (items.length === 0) return "No upcoming reminders.";
        return items
          .map(
            (r) =>
              `[${r.category}] ${r.title} — ${r.nextDueAt ? new Date(r.nextDueAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "no date"}${r.advanceNoticeDays > 0 ? ` (${r.advanceNoticeDays}d advance notice)` : ""}${r.description ? ` — ${r.description}` : ""}`
          )
          .join("\n");
      }
      return "Unknown reminders command. Use: list, search, add, update, delete, upcoming";
    }

    if (name === "agent_manager") {
      const cmdArgs = [args.command, args.arg1, args.arg2].filter(Boolean);
      return execFileSync(join(TOOL_SCRIPTS_PATH, "agent_manager.sh"), cmdArgs, {
        timeout: 30000,
        env: getToolEnv(),
        encoding: "utf-8",
      });
    }

    if (name === "delegate_task") {
      const targetAgent = args.agent;
      const taskDesc = args.task;
      const urgency = args.urgency as "sync" | "async";

      if (!targetAgent || !taskDesc) {
        return "Error: agent and task are required for delegate_task";
      }

      if (urgency === "sync") {
        // Synchronous: call the target agent directly and return the result
        // Dynamic import to avoid circular dependency with gemini.ts
        const { autonomousChat } = await import("./gemini");
        const result = await autonomousChat(targetAgent, taskDesc, { fromAgent: agentId });
        return result || "The agent completed the task but returned no response.";
      } else {
        // Async: queue the task for the target agent's heartbeat to pick up
        const taskId = createTask(agentId, targetAgent, taskDesc, "async");
        return `Task queued for ${targetAgent} agent (ID: ${taskId}). The result will be available on your next check-in.`;
      }
    }

    if (name === "workflow_manager") {
      const { query: dbQuery } = await import("./db");
      const { WORKFLOW_TYPES } = await import("./workflow-types");
      const cmd = args.command;

      if (cmd === "list-workflows") {
        const filterAgent = args.arg1;
        const params: unknown[] = [];
        let where = 'WHERE w."deletedAt" IS NULL';
        if (filterAgent) {
          params.push(filterAgent);
          where += ` AND w."ownerAgent" = $${params.length}`;
        }
        const rows = await dbQuery(
          `SELECT w.id, w.name, w.stage, w."itemType", w."ownerAgent",
                  b.name AS board_name
           FROM "_workflow" w
           LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
           ${where} ORDER BY w.name ASC LIMIT 50`,
          params
        );
        if (rows.length === 0) return filterAgent ? `No workflows owned by ${filterAgent}.` : "No workflows found.";
        return rows.map((r: Record<string, unknown>) =>
          `- ${r.name} [${r.stage}] owner=${r.ownerAgent || "unassigned"} type=${r.itemType} board="${r.board_name || "none"}" id=${r.id}`
        ).join("\n");
      }

      if (cmd === "get-workflow") {
        if (!args.arg1) return "Error: arg1 (workflowId) is required";
        const rows = await dbQuery(
          `SELECT w.id, w.name, w.stage, w.spec, w."itemType", w."ownerAgent",
                  b.name AS board_name, b.stages AS board_stages
           FROM "_workflow" w
           LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
           WHERE w.id = $1 AND w."deletedAt" IS NULL`,
          [args.arg1]
        );
        if (rows.length === 0) return "Workflow not found.";
        const w = rows[0] as Record<string, unknown>;
        const itemRows = await dbQuery(
          `SELECT stage, COUNT(*)::text AS count FROM "_workflow_item"
           WHERE "workflowId" = $1 AND "deletedAt" IS NULL GROUP BY stage`,
          [args.arg1]
        );
        const counts = itemRows.map((r: Record<string, unknown>) => `${r.stage}: ${r.count}`).join(", ");
        return `Workflow: ${w.name}\nStage: ${w.stage}\nOwner: ${w.ownerAgent || "unassigned"}\nType: ${w.itemType}\nBoard: ${w.board_name || "none"}\nItems: ${counts || "none"}`;
      }

      if (cmd === "create-workflow") {
        if (!args.arg1) return "Error: arg1 (name) is required";
        if (!args.arg2) return "Error: arg2 (boardId) is required";
        const owner = args.arg3 || null;
        const itemType = args.arg4 || "person";
        const rows = await dbQuery(
          `INSERT INTO "_workflow" (name, spec, "itemType", "boardId", "ownerAgent", stage, "createdAt", "updatedAt")
           VALUES ($1, '', $2, $3, $4, 'PLANNING', NOW(), NOW()) RETURNING id`,
          [args.arg1, itemType, args.arg2, owner]
        );
        const id = (rows[0] as Record<string, unknown>).id;
        return `Workflow created: "${args.arg1}" (id: ${id}) owner=${owner || "unassigned"} stage=PLANNING`;
      }

      if (cmd === "update-workflow-stage") {
        if (!args.arg1) return "Error: arg1 (workflowId) is required";
        if (!args.arg2) return "Error: arg2 (stage) is required";
        const validStages = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED"];
        const newStage = args.arg2.toUpperCase();
        if (!validStages.includes(newStage)) return `Error: stage must be one of: ${validStages.join(", ")}`;
        await dbQuery(
          `UPDATE "_workflow" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
          [newStage, args.arg1]
        );
        return `Workflow ${args.arg1} stage updated to ${newStage}.`;
      }

      if (cmd === "assign-workflow") {
        if (!args.arg1) return "Error: arg1 (workflowId) is required";
        if (!args.arg2) return "Error: arg2 (agentId) is required";
        await dbQuery(
          `UPDATE "_workflow" SET "ownerAgent" = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
          [args.arg2, args.arg1]
        );
        return `Workflow ${args.arg1} assigned to ${args.arg2}.`;
      }

      if (cmd === "list-boards") {
        const rows = await dbQuery(
          `SELECT id, name, description FROM "_board" WHERE "deletedAt" IS NULL ORDER BY name ASC`
        );
        if (rows.length === 0) return "No boards found.";
        return rows.map((r: Record<string, unknown>) =>
          `- ${r.name}${r.description ? ` — ${r.description}` : ""} (id: ${r.id})`
        ).join("\n");
      }

      if (cmd === "list-templates") {
        return Object.values(WORKFLOW_TYPES).map((t) =>
          `- ${t.label} [${t.itemType}]: ${t.description} (id: ${t.id})`
        ).join("\n");
      }

      return "Unknown workflow_manager command. Use: list-workflows, get-workflow, create-workflow, update-workflow-stage, assign-workflow, list-boards, list-templates";
    }

    return `Unknown tool: ${name}`;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Tool error: ${msg}`;
  }
}
