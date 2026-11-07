export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = { [key: string]: Json };

export type Tool = {
  name: string;
  description: string;
  readOnly: boolean | null;
  schema: Schema | null;
};

export type Snapshot = {
  id: string;
  app: string;
  label: string;
  taken: number;
  source: "formmcp" | "file" | "now";
  server: string;
  tools: Tool[];
};

export type Level = "breaking" | "caution" | "additive" | "note";

export type Change = {
  path: string;
  level: Level;
  text: string;
};

export type Status = "added" | "removed" | "renamed" | "changed" | "same";

export type ToolDiff = {
  name: string;
  status: Status;
  from?: string;
  level: Level | null;
  changes: Change[];
};

export type Counts = { added: number; removed: number; renamed: number; changed: number; same: number; breaking: number };

export type Diff = {
  tools: ToolDiff[];
  counts: Counts;
  argsCompared: boolean;
  notes: string[];
};

export const RANK: Record<Level, number> = { breaking: 3, caution: 2, additive: 1, note: 0 };

export function hasSchemas(s: Snapshot): boolean {
  return s.tools.length > 0 && s.tools.every((t) => t.schema !== null);
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function sameTools(a: Tool[], b: Tool[]): boolean {
  return canonical(a) === canonical(b);
}
