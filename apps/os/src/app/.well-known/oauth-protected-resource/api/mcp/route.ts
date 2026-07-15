import { getMcpProtectedResourceMetadata } from "@/lib/mcp-public-url";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
};

export async function GET() {
  return Response.json(getMcpProtectedResourceMetadata(), { headers: corsHeaders });
}
