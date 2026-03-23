/**
 * Workflow Type Registry
 *
 * Defines reusable workflow templates that agents reference via workflowTypes[].
 * Each type specifies the item kind (person/content) and a default board
 * with stages and transitions used when creating new workflows.
 *
 * Stages can be marked `requiresHuman: true` — these stages send a notification
 * to the human and block advancement until the human completes the required action.
 */

export interface StageSpec {
  key: string;
  label: string;
  color: string;
  /** Default instructions describing what the agent should do at this stage. */
  instructions: string;
  /**
   * If true, this stage requires human involvement before the item can advance.
   * The system sends a notification and blocks progression until the human
   * completes the required action (approval, content delivery, etc.).
   */
  requiresHuman?: boolean;
  /** What the human needs to do at this stage (shown in notification + UI). */
  humanAction?: string;
}

export interface WorkflowTypeSpec {
  /** Unique slug for this workflow type */
  id: string;
  /** Human-readable label */
  label: string;
  /** What kind of items this workflow tracks */
  itemType: "person" | "content";
  /** Description for humans */
  description: string;
  /**
   * Default board template used when creating a new workflow of this type.
   * Active workflows use their stored board as source of truth.
   */
  defaultBoard: {
    stages: StageSpec[];
    transitions: Record<string, string[]>;
  };
}

export const WORKFLOW_TYPES: Record<string, WorkflowTypeSpec> = {
  // ─── Target Research Pipeline (Scout) ──────────────────────────

  "research-pipeline": {
    id: "research-pipeline",
    label: "Target Research Pipeline",
    itemType: "person",
    description:
      "Find targets from news, LinkedIn posts, and industry activity. Enrich their profiles, " +
      "qualify them against the campaign spec, and hand off approved targets to Tim for outreach.",
    defaultBoard: {
      stages: [
        {
          key: "FINDING",
          label: "Finding",
          color: "#6b8a9e",
          instructions:
            "Scout searches for potential targets by monitoring LinkedIn posts, industry news, " +
            "press mentions, conference speakers, and relevant online activity. Look for people " +
            "who match the campaign spec's target audience (role, industry, company size). " +
            "Log their name, LinkedIn profile URL, and what triggered the find (e.g., 'posted about data pipelines', " +
            "'quoted in TechCrunch article'). Cross-check against existing CRM contacts to avoid duplicates.",
        },
        {
          key: "ENRICHING",
          label: "Enriching",
          color: "#2563EB",
          instructions:
            "Scout enriches the target's profile with detailed research. Pull data from LinkedIn, " +
            "company website, Crunchbase, and news sources. Document: full name and title, " +
            "company name/size/industry, recent LinkedIn posts or articles they've shared, " +
            "mutual connections, interests or pain points relevant to the campaign, " +
            "and any conversation starters (recent promotion, company funding, speaking engagement).",
        },
        {
          key: "QUALIFICATION",
          label: "Qualification",
          color: "#16A34A",
          instructions:
            "Scout evaluates the enriched profile against the campaign spec criteria. " +
            "Prepare a qualification summary: why this target is a fit, quality score (1-5), " +
            "recommended messaging angle, and any risks (e.g., competitor relationship). " +
            "Submit for human review before handoff.",
          requiresHuman: true,
          humanAction:
            "Review Scout's qualified targets. Approve for handoff to Tim's outreach, " +
            "reject with a reason, or add specific notes for Tim's messaging approach.",
        },
        {
          key: "HANDED_OFF",
          label: "Handed Off",
          color: "#9B59B6",
          instructions:
            "Target approved and passed to Tim's LinkedIn Outreach pipeline. " +
            "Scout's enrichment data, qualification summary, and any human notes are " +
            "attached to the CRM record. Tim will use this to craft a personalized connection request.",
        },
        {
          key: "REJECTED",
          label: "Rejected",
          color: "#DC2626",
          instructions:
            "Target does not meet campaign criteria. Log the specific reason " +
            "(wrong seniority, company too small, not in target industry, competitor relationship, etc.) " +
            "to refine future finding accuracy.",
        },
      ],
      transitions: {
        FINDING: ["ENRICHING", "REJECTED"],
        ENRICHING: ["QUALIFICATION", "REJECTED"],
        QUALIFICATION: ["HANDED_OFF", "REJECTED"],
        HANDED_OFF: [],
        REJECTED: [],
      },
    },
  },

  // ─── LinkedIn Outreach (Tim) ──────────────────────────────────

  "linkedin-outreach": {
    id: "linkedin-outreach",
    label: "LinkedIn Outreach Cold",
    itemType: "person",
    description:
      "Cold outreach via LinkedIn: connection request → message sequence (up to 3) → ended. " +
      "Sends CRs during target's working hours (or PST if unknown), spread ~1 per hour. " +
      "Replies and conversions are tracked in the CRM engagement model (CEM), not here.",
    defaultBoard: {
      stages: [
        {
          key: "TARGET",
          label: "Target",
          color: "#6b8a9e",
          instructions:
            "Prospect received from Scout's research pipeline with enrichment data. " +
            "Tim personalizes the approved connection request template using the target's " +
            "name, company, and Scout's research notes. Send during the target's working hours " +
            "(use their timezone if known, otherwise PST). Space out requests — max 1 per hour.",
        },
        {
          key: "INITIATED",
          label: "CR Sent",
          color: "#2563EB",
          instructions:
            "Connection request sent with personalized note. Monitor for acceptance. " +
            "If no response after 14 days, mark as ended — do not re-send. " +
            "Log the send time and timezone used.",
        },
        {
          key: "ACCEPTED",
          label: "CR Accepted",
          color: "#16A34A",
          instructions:
            "Connection accepted. Tim drafts the first outreach message using the campaign " +
            "spec messaging guidelines and Scout's research notes. Lead with value — reference " +
            "the published article or a shared interest. Do not pitch on first message.",
        },
        {
          key: "MESSAGE_DRAFT",
          label: "Message Draft (3)",
          color: "#D4A017",
          instructions:
            "Tim drafts a message for this prospect. Up to 3 messages in the sequence, " +
            "spaced 2-5 days apart. Each message should add value and not repeat previous ones. " +
            "Follow-ups reference the prior message naturally. After 3 messages with no reply, " +
            "move to Ended.",
          requiresHuman: true,
          humanAction:
            "Review and approve the message before Tim sends it. Check tone, personalization, " +
            "and that it adds value beyond previous messages. You can edit or reject with feedback.",
        },
        {
          key: "MESSAGED",
          label: "Messaged",
          color: "#D85A30",
          instructions:
            "Message sent. Wait 2-5 days for a reply before sending next follow-up. " +
            "After 3 messages with no reply, move to Ended. " +
            "If the prospect replies, handle in CEM outside this workflow.",
        },
        {
          key: "ENDED",
          label: "Ended",
          color: "#555",
          instructions:
            "All 3 messages sent with no reply, or connection request ignored after 14 days. " +
            "Outreach sequence complete. Log the outcome for campaign analytics. " +
            "Replies and conversions are tracked separately in the CRM engagement model.",
        },
      ],
      transitions: {
        TARGET: ["INITIATED"],
        INITIATED: ["ACCEPTED", "ENDED"],
        ACCEPTED: ["MESSAGE_DRAFT"],
        MESSAGE_DRAFT: ["MESSAGED"],
        MESSAGED: ["MESSAGE_DRAFT", "ENDED"],
        ENDED: [],
      },
    },
  },

  // ─── Content Pipeline (Ghost) ─────────────────────────────────

  "content-pipeline": {
    id: "content-pipeline",
    label: "Content Pipeline",
    itemType: "content",
    description:
      "Manage content from ideation through drafting, review, and publication",
    defaultBoard: {
      stages: [
        {
          key: "IDEA",
          label: "Idea",
          color: "#6b8a9e",
          instructions:
            "Content idea generated based on the campaign spec. Ghost researches the topic, " +
            "identifies the target audience angle, and creates a content brief with: " +
            "working title, key points to cover, target keywords, estimated word count, " +
            "and how it connects to the campaign's messaging.",
          requiresHuman: true,
          humanAction:
            "Review Ghost's content brief and approve the topic. Provide any additional " +
            "direction, specific angles, or data points to include. Reject if the topic " +
            "doesn't align with campaign goals.",
        },
        {
          key: "DRAFTING",
          label: "Drafting",
          color: "#2563EB",
          instructions:
            "Ghost writes the full draft following the approved brief and campaign spec. " +
            "Match the tone guidelines from the campaign spec. Include relevant data, " +
            "quotes, and actionable insights. Optimize for SEO with target keywords. " +
            "Tag sections that might need human expertise or fact-checking.",
        },
        {
          key: "REVIEW",
          label: "Review",
          color: "#D85A30",
          instructions:
            "Draft complete. Ready for human review.",
          requiresHuman: true,
          humanAction:
            "Review the draft for accuracy, tone, and campaign alignment. " +
            "Edit or provide feedback. Approve to move to publishing, " +
            "or send back to Drafting with revision notes.",
        },
        {
          key: "DRAFT_PUBLISHED",
          label: "Draft Published",
          color: "#D4A017",
          instructions:
            "Ghost has automatically published the approved draft to Beehiiv as a draft post. " +
            "The Beehiiv link and summary are available as an artifact. " +
            "Human reviews the draft on Beehiiv, makes any final edits, then approves here to move to Published.",
          requiresHuman: true,
          humanAction:
            "Click the Beehiiv link to review the draft on the platform. Make any final edits directly in Beehiiv. " +
            "When you're happy with it, approve here to mark as Published and trigger downstream workflows.",
        },
        {
          key: "PUBLISHED",
          label: "Published",
          color: "#1D9E75",
          instructions:
            "Article is live. Publication URL and summary are recorded. This is the final stage — " +
            "items remain here permanently as the completed output of the content pipeline. " +
            "Downstream workflows (Content Distribution, Target Research) are now unblocked.",
        },
      ],
      transitions: {
        IDEA: ["DRAFTING"],
        DRAFTING: ["REVIEW"],
        REVIEW: ["DRAFT_PUBLISHED", "DRAFTING"],
        DRAFT_PUBLISHED: ["PUBLISHED"],
        PUBLISHED: [],
      },
    },
  },

  // ─── Content Distribution (Marni) ─────────────────────────────

  "content-distribution": {
    id: "content-distribution",
    label: "Content Distribution",
    itemType: "content",
    description:
      "Create LinkedIn posts and connection request messaging from published content",
    defaultBoard: {
      stages: [
        {
          key: "RECEIVED",
          label: "Received",
          color: "#6b8a9e",
          instructions:
            "Published content received from Ghost's pipeline with the live URL. " +
            "Marni reviews the source material and prepares distribution assets.",
        },
        {
          key: "CONN_MSG_DRAFTED",
          label: "Connection Message",
          color: "#D85A30",
          instructions:
            "Marni drafts a LinkedIn connection request message template based on the " +
            "campaign spec and published article. The template should be under 300 characters, " +
            "reference the article or shared interests, and feel personal — not salesy. " +
            "Include {firstName} and {company} placeholders for Tim to personalize per target.",
          requiresHuman: true,
          humanAction:
            "Review the connection request message template. This is what Tim will send " +
            "to each target (personalized with their name/company). Approve, edit, or reject. " +
            "Once approved, Tim can start sending connection requests.",
        },
        {
          key: "POST_DRAFTED",
          label: "Post Drafted",
          color: "#2563EB",
          instructions:
            "LinkedIn post drafted from the source article. Ready for human review.",
          requiresHuman: true,
          humanAction:
            "Review the LinkedIn post draft. Approve for publishing on your LinkedIn profile, " +
            "or request edits. Once approved, the post moves to Posted.",
        },
        {
          key: "POSTED",
          label: "Posted",
          color: "#16A34A",
          instructions:
            "LinkedIn post approved and published. Post is live on your profile.",
        },
      ],
      transitions: {
        RECEIVED: ["CONN_MSG_DRAFTED"],
        CONN_MSG_DRAFTED: [],
        POST_DRAFTED: ["POSTED"],
        POSTED: [],
      },
    },
  },

};

/** Look up a workflow type by ID. Returns undefined if not found. */
export function getWorkflowType(id: string): WorkflowTypeSpec | undefined {
  return WORKFLOW_TYPES[id];
}
