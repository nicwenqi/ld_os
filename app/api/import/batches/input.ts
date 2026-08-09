const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS = new Set(["limit", "offset"]);

export class ImportBatchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportBatchInputError";
  }
}

export function parseHistoryQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) if (!KEYS.has(key)) throw new ImportBatchInputError("导入历史查询参数无效");
  const limit = parseBounded(params.get("limit"), 25, 1, 100, "历史条数无效");
  const offset = parseBounded(params.get("offset"), 0, 0, 10_000, "历史偏移无效");
  return { limit, offset };
}

export function parseBatchId(value: string) {
  if (!UUID.test(value)) throw new ImportBatchInputError("导入批次标识无效");
  return value.toLowerCase();
}

function parseBounded(value: string | null, fallback: number, minimum: number, maximum: number, message: string) {
  if (value === null) return fallback;
  if (!/^[0-9]+$/.test(value)) throw new ImportBatchInputError(message);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new ImportBatchInputError(message);
  return parsed;
}
