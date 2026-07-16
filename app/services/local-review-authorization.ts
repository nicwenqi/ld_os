import { readCookie } from "../api/auth/cookies.ts";
import { readMockSession } from "../api/auth/mock-session-store.ts";
import { AuthorizationError } from "./production-authorization.ts";

export function requireLocalReviewManager(request: Request) {
  const session = readMockSession(readCookie(request));
  if (!session?.authenticated) {
    throw new AuthorizationError(401, "请先登录当前酒店");
  }
  if (session.role !== "property_ld_manager" || !session.propertyId) {
    throw new AuthorizationError(403, "仅酒店学习与发展经理可管理此项资料");
  }
  return session;
}
