export async function GET() {
  return Response.json({ message: "此端点已移除" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
