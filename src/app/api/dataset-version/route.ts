import { getDatasetVersion } from "@/lib/dataset-version";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ version: getDatasetVersion() }, { headers: { "Cache-Control": "no-store" } });
}
