import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";

/**
 * POST /api/crm/packages/simulate
 *
 * Advances all non-human stages in a package's workflows by one step.
 * At each non-human stage, creates a mock artifact, then advances.
 * Stops at any stage that requiresHuman — those appear in Friday's queue.
 *
 * Call repeatedly to walk through the simulation. Each call advances
 * all eligible items by one stage.
 *
 * Body: { packageId: string }
 */

const MOCK_ARTIFACTS: Record<string, Record<string, { name: string; content: string }>> = {
  "content-pipeline": {
    IDEA: {
      name: "Content Brief",
      content: `# Content Brief: The Future of B2B Influencer Marketing

## Working Title
"Why B2B Brands Are Betting Big on Influencer Partnerships in 2026"

## Key Points to Cover
- The shift from B2C to B2B influencer strategies
- Data: 78% of B2B buyers trust peer recommendations over vendor content
- Case studies: 3 companies that drove pipeline through influencer content
- How to identify and engage industry thought leaders
- Measuring ROI beyond vanity metrics

## Target Keywords
- B2B influencer marketing
- thought leadership partnerships
- B2B content strategy 2026

## Target Audience Angle
VP/Director-level marketing leaders at mid-market SaaS companies who are exploring influencer strategies but lack a playbook.

## Estimated Word Count
1,800 - 2,200 words

## Campaign Connection
This article positions Strattegys as the expert in B2B influencer outreach, directly supporting the outreach messaging to qualified targets.`,
    },
    DRAFTING: {
      name: "Article Draft",
      content: `# Why B2B Brands Are Betting Big on Influencer Partnerships in 2026

*By Ghost — Draft v1*

## Introduction

The B2B marketing landscape is undergoing a fundamental shift. While consumer brands have long leveraged influencers to drive awareness and sales, B2B companies are now discovering that industry thought leaders can be their most powerful growth channel.

According to recent research, 78% of B2B decision-makers say they trust recommendations from industry peers over traditional vendor marketing. This isn't surprising — in a world of information overload, buyers increasingly rely on trusted voices to cut through the noise.

## The Rise of B2B Influencer Strategy

Unlike B2C influencer marketing, B2B influencer partnerships aren't about follower counts or viral moments. They're about credibility, expertise, and authentic thought leadership.

Consider these three companies that have successfully leveraged influencer partnerships:

**Company A: CloudScale (Series B SaaS)**
CloudScale partnered with three DevOps thought leaders who collectively reached 150K technical decision-makers on LinkedIn. The result: 47 qualified demos in 90 days, with a 3.2x better conversion rate compared to paid ads.

**Company B: DataPulse (Mid-market Analytics)**
By co-creating a research report with an industry analyst, DataPulse generated 890 downloads and 23 enterprise meetings — all from a single content collaboration.

**Company C: SecureOps (Cybersecurity)**
SecureOps built a "CISO Council" of 5 industry influencers who contributed to a monthly security briefing. Within 6 months, the briefing had 2,400 subscribers and drove 31% of their qualified pipeline.

## Identifying the Right Influencers

The key to B2B influencer success lies in targeting the right partners. Look for:

1. **Domain expertise** — They must be genuinely knowledgeable in your space
2. **Engaged audience** — Quality over quantity. A LinkedIn post with 50 thoughtful comments beats 5,000 likes
3. **Content consistency** — They regularly publish and engage with their community
4. **Alignment** — Their values and messaging naturally complement your brand

## Building Authentic Partnerships

The most effective B2B influencer relationships are long-term partnerships, not transactional sponsorships. Consider these approaches:

- **Co-created content** — Write articles, host webinars, or produce research together
- **Advisory relationships** — Engage influencers as advisors or board members
- **Event collaboration** — Feature them at conferences or create joint events
- **Community building** — Include them in exclusive communities or councils

## Measuring What Matters

Traditional influencer metrics (impressions, likes) don't capture B2B value. Focus on:

- **Pipeline influence** — Did the content contribute to deals in your pipeline?
- **Meeting generation** — How many qualified meetings resulted from influencer content?
- **Content engagement quality** — Are the right people (ICP-matching titles) engaging?
- **Brand perception shift** — Survey-based measurement of credibility improvement

## Conclusion

B2B influencer marketing isn't a trend — it's a strategic imperative. Companies that build authentic relationships with industry thought leaders will have a sustainable competitive advantage in reaching and influencing buying committees.

The question isn't whether to invest in B2B influencer partnerships, but how quickly you can start building them.

---

*[Draft note: Sections on measuring ROI may need human expertise. Case study data should be fact-checked.]*`,
    },
  },
  "research-pipeline": {
    FINDING: {
      name: "Target Discovery Report",
      content: `# Target Discovery Report

## Targets Found: 5 potential matches

### 1. Sarah Chen — VP Marketing, TechFlow
- **Source:** LinkedIn post about "rethinking B2B content strategy"
- **LinkedIn:** linkedin.com/in/sarahchen-techflow
- **Why:** Posted 3 articles on influencer marketing ROI in the last month
- **CRM Status:** New contact

### 2. Marcus Johnson — CMO, DataBridge Solutions
- **Source:** Featured in MarTech Today article on B2B growth
- **LinkedIn:** linkedin.com/in/marcusjohnson
- **Why:** Quoted saying "we need more authentic voices in B2B"
- **CRM Status:** New contact

### 3. Priya Patel — Director of Growth, CloudNine
- **Source:** Conference speaker at SaaS Growth Summit 2026
- **LinkedIn:** linkedin.com/in/priyapatel-cloudnine
- **Why:** Spoke about "the influencer gap in enterprise marketing"
- **CRM Status:** New contact

### 4. David Kim — Head of Content, ScaleUp Inc
- **Source:** Published LinkedIn newsletter with 12K subscribers
- **LinkedIn:** linkedin.com/in/davidkim-scaleup
- **Why:** Actively seeking content partnerships
- **CRM Status:** New contact

### 5. Rachel Torres — VP Partnerships, GrowthEngine
- **Source:** Podcast interview about B2B marketing evolution
- **LinkedIn:** linkedin.com/in/racheltorres
- **Why:** Mentioned looking for "thought leadership partners"
- **CRM Status:** New contact`,
    },
    ENRICHING: {
      name: "Target Enrichment Report",
      content: `# Target Enrichment: Sarah Chen

## Profile Summary
- **Name:** Sarah Chen
- **Title:** VP Marketing
- **Company:** TechFlow (Series C, 200-500 employees)
- **Industry:** Enterprise SaaS / Data Infrastructure
- **Location:** San Francisco, CA

## Company Intel
- TechFlow raised $85M Series C in Jan 2026
- Competing in the data pipeline space
- Recently launched a partner program
- ~450 employees, growing 40% YoY

## Recent LinkedIn Activity
- 3 posts about B2B content strategy in last 30 days
- Shared article: "Why B2B needs its own influencer playbook"
- Commented on industry analysis posts regularly
- Engagement rate: ~4.2% (above average for B2B executives)

## Mutual Connections
- 2 shared connections via industry groups
- Both members of "B2B Marketing Leaders" LinkedIn group

## Conversation Starters
- Her recent post about content strategy ROI aligns with our article topic
- TechFlow's new partner program could be a collaboration angle
- She mentioned "looking for authentic voices" in a recent comment

## Qualification Notes
- Strong ICP match: right title, company size, industry
- Actively discussing topics aligned with our campaign
- High engagement = receptive to outreach
- **Recommended messaging angle:** Lead with the article, position as peer-to-peer content collaboration`,
    },
  },
  "content-distribution": {
    RECEIVED: {
      name: "Distribution Plan",
      content: `# Distribution Plan

## Source Content
- Article: "Why B2B Brands Are Betting Big on Influencer Partnerships in 2026"
- URL: [pending publication]

## Planned Outputs
1. **3 LinkedIn Posts** — Different angles from the article
2. **Outreach messaging templates** — For Tim's prospect engagement
3. **Key quote cards** — Shareable snippets

## LinkedIn Post Angles
1. The data hook: "78% of B2B buyers trust peer recs..."
2. The case study angle: Highlight CloudScale's 3.2x conversion lift
3. The provocative take: "B2B influencer marketing isn't optional anymore"

## Messaging Angles for Outreach
- For marketing VPs: "We just published research on B2B influencer ROI..."
- For content leaders: "Interesting data on content collaboration impact..."
- For growth leaders: "Saw you're thinking about influencer partnerships..."`,
    },
    REPURPOSING: {
      name: "LinkedIn Post Drafts",
      content: `# LinkedIn Post Drafts

## Post 1: The Data Hook

---

78% of B2B buyers trust peer recommendations over vendor content.

Yet most B2B companies still rely almost entirely on paid ads and gated whitepapers to reach decision-makers.

We dug into 3 companies that flipped the script:

→ CloudScale: 47 qualified demos in 90 days through thought leader partnerships
→ DataPulse: 890 report downloads from a single analyst collaboration
→ SecureOps: 31% of qualified pipeline from their CISO Council content

The common thread? Authentic partnerships > transactional sponsorships.

Full breakdown: [article URL]

#B2BMarketing #ThoughtLeadership #ContentStrategy

---

## Post 2: The Case Study

---

CloudScale (Series B SaaS) partnered with 3 DevOps thought leaders.

No paid sponsorships. No influencer fees. Just genuine content collaboration.

The result:
• Reached 150K technical decision-makers
• Generated 47 qualified demos
• 3.2x better conversion vs. paid ads

Here's what they did differently: [article URL]

The B2B influencer playbook is simpler than you think.

#B2B #GrowthMarketing #SaaS

---

## Post 3: The Provocative Take

---

Hot take: If you're a B2B company without an influencer strategy in 2026, you're leaving pipeline on the table.

Not the "pay a celebrity to hold your product" kind.

The "build genuine relationships with people your buyers already trust" kind.

We wrote the playbook. It's based on what's actually working: [article URL]

#B2BMarketing #InfluencerMarketing #Revenue`,
    },
  },
};

export async function POST(req: NextRequest) {
  try {
    const { packageId } = await req.json();
    if (!packageId) {
      return NextResponse.json({ error: "packageId is required" }, { status: 400 });
    }

    // Get all workflows in this package
    const workflows = await query<{
      id: string;
      name: string;
      ownerAgent: string;
      spec: { workflowType?: string; targetCount?: number };
      itemType: string;
    }>(
      `SELECT id, name, "ownerAgent", spec, "itemType"
       FROM "_workflow"
       WHERE "packageId" = $1 AND "deletedAt" IS NULL`,
      [packageId]
    );

    const advances: Array<{
      workflow: string;
      item: string;
      from: string;
      to: string;
      artifact?: string;
      stoppedAt?: string;
    }> = [];

    for (const wf of workflows) {
      const wfSpec = typeof wf.spec === "string" ? JSON.parse(wf.spec) : wf.spec;
      const wfTypeId = wfSpec?.workflowType;
      const wfType = wfTypeId ? WORKFLOW_TYPES[wfTypeId] : null;
      if (!wfType) continue;

      // Get all items in this workflow
      const items = await query<{
        id: string;
        stage: string;
        sourceType: string;
        sourceId: string;
      }>(
        `SELECT id, stage, "sourceType", "sourceId"
         FROM "_workflow_item"
         WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
        [wf.id]
      );

      for (const item of items) {
        const stageSpec = wfType.defaultBoard.stages.find((s) => s.key === item.stage);
        if (!stageSpec) continue;

        // Create mock artifact for this stage if we have one
        const mockData = MOCK_ARTIFACTS[wfTypeId]?.[item.stage];
        if (mockData) {
          // Check if artifact already exists for this item+stage (prevent duplicates)
          const existing = await query(
            `SELECT id FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = $2 AND "deletedAt" IS NULL`,
            [item.id, item.stage]
          );
          if (existing.length === 0) {
            await query(
              `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
              [item.id, wf.id, item.stage, mockData.name, "markdown", mockData.content]
            );
          }
        }

        // If this stage requires human, stop AFTER creating artifact — it'll appear in Friday's queue
        if (stageSpec.requiresHuman) {
          advances.push({
            workflow: wf.name,
            item: item.id,
            from: item.stage,
            to: item.stage,
            artifact: mockData?.name,
            stoppedAt: `Waiting for human: ${stageSpec.humanAction}`,
          });
          continue;
        }

        // Advance to next stage
        const transitions = wfType.defaultBoard.transitions[item.stage] || [];
        const nextStage = transitions[0]; // Take first valid transition
        if (!nextStage) continue;

        await query(
          `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2`,
          [nextStage, item.id]
        );

        advances.push({
          workflow: wf.name,
          item: item.id,
          from: item.stage,
          to: nextStage,
          artifact: mockData?.name,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      advances,
      summary: `Advanced ${advances.filter((a) => a.from !== a.to).length} items, ${advances.filter((a) => a.stoppedAt).length} waiting for human`,
    });
  } catch (error) {
    console.error("[simulate] error:", error);
    return NextResponse.json({ error: "Failed to simulate" }, { status: 500 });
  }
}
