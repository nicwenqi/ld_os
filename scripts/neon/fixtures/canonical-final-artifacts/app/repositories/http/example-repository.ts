import type { ExampleRepository } from "../contracts/example-repository.ts";

export function createHttpExampleRepository(): ExampleRepository {
  return {
    async listThings() {
      const response = await fetch("/api/example", {
        cache: "no-store",
        credentials: "same-origin",
      });
      return response.json() as Promise<readonly string[]>;
    },
  };
}
