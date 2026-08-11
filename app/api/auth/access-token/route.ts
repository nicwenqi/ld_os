export async function GET() {
  return Response.json({ message: "浏览器不会获得认证提供方 bearer token" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
