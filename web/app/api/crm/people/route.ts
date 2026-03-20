import { NextResponse, type NextRequest } from "next/server";
import { crmFetch } from "@/lib/crm";

export async function GET(request: NextRequest) {
  const campaignId = request.nextUrl.searchParams.get("campaignId");
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
  }

  try {
    const path =
      `/rest/people?filter[activeCampaignId][eq]=${campaignId}&limit=200` +
      `&orderBy=name.firstName=AscNullsLast`;
    const data = await crmFetch(path);
    const raw = data.data?.people ?? data.people ?? data.data ?? [];
    const people = raw.map((p: Record<string, unknown>) => {
      const name = p.name as Record<string, string> | undefined;
      const emails = p.emails as Record<string, string> | undefined;
      const linkedin = p.linkedinLink as Record<string, string> | undefined;
      const company = p.company as Record<string, unknown> | undefined;
      return {
        id: p.id,
        firstName: name?.firstName ?? "",
        lastName: name?.lastName ?? "",
        jobTitle: p.jobTitle ?? "",
        email: emails?.primaryEmail ?? "",
        linkedinUrl: linkedin?.primaryLinkUrl ?? "",
        stage: p.stage ?? "TARGET",
        city: p.city ?? "",
        companyName: (company?.name as string) ?? "",
      };
    });
    return NextResponse.json({ people });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to fetch people";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
