import "server-only";

const LOGIN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/;
const HOSTNAME_LABEL = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export function deriveDeterministicAuthEmail(loginId: string, hostname: string): string {
  if (!LOGIN_ID.test(loginId) || !validHostname(hostname)) {
    throw new Error("DETERMINISTIC_AUTH_IDENTITY_INVALID");
  }
  return `${loginId.toLowerCase()}@${hostname.toLowerCase()}`;
}

function validHostname(hostname: string): boolean {
  return hostname.length <= 253
    && hostname.split(".").every(label => HOSTNAME_LABEL.test(label));
}
