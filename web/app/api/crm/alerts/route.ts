import { NextResponse, type NextRequest } from "next/server";
import { crmGraphQL } from "@/lib/crm";

/**
 * Returns a map of personId → alert info for people who have an inbound
 * LinkedIn message as their most recent note (i.e. needs a reply).
 *
 * GET /api/crm/alerts?campaignId=xxx
 */
export async function GET(request: NextRequest) {
  const campaignId = request.nextUrl.searchParams.get("campaignId");
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
  }

  try {
    // Fetch people in this campaign with their most recent note
    const query = `
      query CampaignAlerts($campaignId: UUID!) {
        people(
          filter: { activeCampaignId: { eq: $campaignId } }
          first: 200
        ) {
          edges {
            node {
              id
              noteTargets(first: 1, orderBy: { createdAt: DescNullsLast }) {
                edges {
                  node {
                    note {
                      id
                      title
                      createdAt
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await crmGraphQL(query, { campaignId });
    const edges = data?.people?.edges ?? [];

    const alerts: Record<string, { type: string; title: string; createdAt: string }> = {};

    for (const { node: person } of edges) {
      const noteEdges = person.noteTargets?.edges ?? [];
      if (noteEdges.length === 0) continue;

      const latestNote = noteEdges[0].node.note;
      if (!latestNote?.title) continue;

      const title: string = latestNote.title;

      if (title.startsWith("LinkedIn Message from")) {
        alerts[person.id] = {
          type: "linkedin_reply",
          title,
          createdAt: latestNote.createdAt,
        };
      } else if (title.startsWith("LinkedIn Connection Accepted")) {
        alerts[person.id] = {
          type: "linkedin_accepted",
          title,
          createdAt: latestNote.createdAt,
        };
      }
    }

    return NextResponse.json({ alerts });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to fetch alerts";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
