export type LatestRequestGate = {
  begin(): number;
  isCurrent(token: number): boolean;
  invalidate(): void;
};

/**
 * Correlates async work without coupling the caller to a specific transport.
 * Starting or invalidating a request makes every earlier token stale.
 */
export function createLatestRequestGate(): LatestRequestGate {
  let generation = 0;

  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
    invalidate() {
      generation += 1;
    },
  };
}
