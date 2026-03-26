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

  // ─── Warm Outreach (Tim) — existing contacts, LinkedIn DM only ─────────

  "warm-outreach": {
    id: "warm-outreach",
    label: "Warm Outreach",
    itemType: "person",
    description:
      "Warm outreach to existing contacts via LinkedIn DM. Govind provides contacts one at a time. " +
      "3-message outreach sequence, then ongoing conversation if they reply.",
    defaultBoard: {
      stages: [
        {
          key: "AWAITING_CONTACT",
          label: "Awaiting Contact",
          color: "#6b8a9e",
          instructions:
            "Human provides the next contact: name, how they know Govind, LinkedIn URL if available, " +
            "and notes on what they do and what might resonate. Tim will research and enrich next.",
          requiresHuman: true,
          humanAction:
            "Who's next? Give me their name, how you know them, and any notes — what they do, " +
            "what they might care about, anything relevant.",
        },
        {
          key: "RESEARCHING",
          label: "Researching",
          color: "#2563EB",
          instructions:
            "Tim enriches the contact using LinkedIn fetch-profile and web_search. Document: " +
            "full name/title, company, recent posts/activity, mutual connections, conversation starters, " +
            "recommended messaging angle.",
        },
        {
          key: "MESSAGE_DRAFT",
          label: "Message Draft",
          color: "#D4A017",
          instructions:
            "Tim drafts a LinkedIn DM for this warm contact. Message 1 (opener): personal opening " +
            "referencing the relationship, brief update on what Govind is building, soft mention of " +
            "taking on projects, referral or direct ask. Message 2 (bump, ~day 3–5): light follow-up, " +
            "add something new, 2–4 sentences max. Message 3 (final nudge, ~day 7–10): close the loop " +
            "with zero pressure, 2–3 sentences max. All messages via the LinkedIn tool only.",
          requiresHuman: true,
          humanAction:
            "Review and approve the message. If the contact has replied, click Replied (on the Messaged step) " +
            "to enter conversation mode.",
        },
        {
          key: "MESSAGED",
          label: "Messaged",
          color: "#D85A30",
          instructions:
            "Message sent via LinkedIn DM. Wait for the follow-up window or a reply. " +
            "After 3 outreach messages with no reply, the sequence ends. If they reply, Govind marks Replied. " +
            "The next MESSAGE_DRAFT opens automatically when the follow-up due date is reached (or start early from Tim’s work queue).",
          requiresHuman: false,
        },
        {
          key: "REPLIED",
          label: "Replied",
          color: "#16A34A",
          instructions:
            "Contact replied on LinkedIn. Transition into conversation mode — Tim drafts replies until Govind ends the sequence.",
        },
        {
          key: "REPLY_DRAFT",
          label: "Reply Draft",
          color: "#D4A017",
          instructions:
            "Tim drafts a reply to the contact's message. Match their energy; continue naturally. " +
            "No cap on replies until Govind ends the sequence.",
          requiresHuman: true,
          humanAction:
            "Review Tim's reply. Approve to send, reject to redraft, or End Sequence if the conversation is done.",
        },
        {
          key: "REPLY_SENT",
          label: "Reply Sent",
          color: "#D85A30",
          instructions: "Reply sent via LinkedIn DM. Tim prepares the next reply draft if the conversation continues.",
        },
        {
          key: "ENDED",
          label: "Ended",
          color: "#555",
          instructions:
            "Sequence complete: either 3 outreach messages with no ongoing conversation, or Govind wrapped up the thread.",
        },
      ],
      transitions: {
        AWAITING_CONTACT: ["RESEARCHING"],
        RESEARCHING: ["MESSAGE_DRAFT"],
        MESSAGE_DRAFT: ["MESSAGED"],
        MESSAGED: ["MESSAGE_DRAFT", "REPLIED", "ENDED"],
        REPLIED: ["REPLY_DRAFT"],
        REPLY_DRAFT: ["REPLY_SENT", "ENDED"],
        REPLY_SENT: ["REPLY_DRAFT"],
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
      "Manage content from ideation through campaign spec, drafting, review, and publication on strattegys.com",
    defaultBoard: {
      stages: [
        {
          key: "IDEA",
          label: "Idea",
          color: "#6b8a9e",
          instructions:
            "Human pastes a short idea summary. This is the seed — just a topic, angle, or rough concept. " +
            "No research or spec work needed at this stage.",
          requiresHuman: true,
          humanAction:
            "Paste a short article idea — a topic, angle, or rough concept. " +
            "Ghost will expand it into a full campaign spec in the next stage.",
        },
        {
          key: "CAMPAIGN_SPEC",
          label: "Campaign Spec",
          color: "#9B59B6",
          instructions:
            "Ghost takes the approved idea and builds a full campaign spec: target audience, " +
            "key angles and arguments, detailed outline with section headers, tone and voice guidelines, " +
            "target SEO keywords, estimated word count, and how the article connects to business goals. " +
            "Submit the spec for human review before proceeding to drafting.",
          requiresHuman: true,
          humanAction:
            "Review Ghost's campaign spec. Check the outline, audience targeting, and angles. " +
            "Approve to proceed to drafting, or send back with feedback and adjustments.",
        },
        {
          key: "DRAFTING",
          label: "Drafting",
          color: "#2563EB",
          instructions:
            "Ghost uses web_search to gather supporting research, then calls article_builder with the " +
            "campaign spec details (topic, research notes, brief, audience, tone, keywords, word count) " +
            "to generate a full MDX article via the Anthropic-backed article_builder. Ghost then creates the draft on strattegys.com " +
            "using publish_article create with the generated content and metadata. " +
            "Move to Review when the draft is live on the site.",
        },
        {
          key: "REVIEW",
          label: "Review",
          color: "#D85A30",
          instructions:
            "Draft article created on strattegys.com. Ready for human review.",
          requiresHuman: true,
          humanAction:
            "Visit strattegys.com/blog/[slug] to review the draft. Check accuracy, tone, and quality. " +
            "Approve to move to Draft Published.",
        },
        {
          key: "DRAFT_PUBLISHED",
          label: "Draft Published",
          color: "#D4A017",
          instructions:
            "The draft is posted to strattegys.com. Human reviews it on the live site before final publish.",
          requiresHuman: true,
          humanAction:
            "Review the article on strattegys.com. Confirm it looks good on the live site. " +
            "Submit to publish it live.",
        },
        {
          key: "PUBLISHED",
          label: "Published",
          color: "#1D9E75",
          instructions:
            "Ghost calls publish_article publish to set the article live on strattegys.com. " +
            "This is the final stage — items remain here as the completed output of the content pipeline. " +
            "Downstream workflows (Content Distribution, Target Research) are now unblocked.",
        },
      ],
      transitions: {
        IDEA: ["CAMPAIGN_SPEC"],
        CAMPAIGN_SPEC: ["DRAFTING"],
        DRAFTING: ["REVIEW"],
        REVIEW: ["DRAFT_PUBLISHED"],
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
