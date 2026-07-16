import type { AuthSession } from "../../repositories/contracts/auth-repository.ts";

const ttlMs = 12 * 60 * 60 * 1000;
const tokenPrefix = "local-review-v1";

type MockSessionEnvelope = {
  version: 1;
  expiresAt: number;
  session: AuthSession;
};

export function createMockSession(session: AuthSession) {
  const envelope: MockSessionEnvelope = {
    version: 1,
    expiresAt: Date.now() + ttlMs,
    session: structuredClone(session),
  };
  return `${tokenPrefix}.${encode(JSON.stringify(envelope))}`;
}

export function readMockSession(token: string | null) {
  if (!token?.startsWith(`${tokenPrefix}.`)) return null;
  try {
    const envelope = JSON.parse(
      decode(token.slice(tokenPrefix.length + 1)),
    ) as MockSessionEnvelope;
    if (
      envelope.version !== 1 ||
      envelope.expiresAt <= Date.now() ||
      !isApprovedSyntheticSession(envelope.session)
    ) return null;
    return structuredClone(envelope.session);
  } catch {
    return null;
  }
}

export function removeMockSession(token: string | null) {
  // Local-review tokens are short-lived, synthetic, and cleared from the browser on logout.
  void token;
}

function isApprovedSyntheticSession(session: AuthSession) {
  return Boolean(
    session.authenticated &&
      session.propertyId === "synthetic-property-a1" &&
      (
        (
          session.userId === "synthetic-property-manager" &&
          session.role === "property_ld_manager"
        ) ||
        (
          session.userId === "synthetic-department-responsible" &&
          session.role === "department_training_responsible"
        )
      ),
  );
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}
