export type AliasEntry = {
  name: string;
  source: string;
  template: string;
};

export type AliasToolInput = {
  args?: string[];
};

const ALIAS_HEADER_RE = /^○ Alias (.+) \(([^)]+)\):$/u;

export function parseAliasShow(stdout: string): AliasEntry[] {
  const lines = stdout.split(/\r?\n/);
  const entries: AliasEntry[] = [];
  let current: AliasEntry | null = null;
  for (const line of lines) {
    const m = line.match(ALIAS_HEADER_RE);
    if (m) {
      if (current) entries.push(current);
      current = { name: m[1].trim(), source: m[2].trim(), template: "" };
      continue;
    }
    if (current && line.startsWith("  ")) {
      current.template += (current.template ? "\n" : "") + line.slice(2);
    }
  }
  if (current) entries.push(current);
  for (const e of entries) {
    e.template = e.template.replace(/\s+$/, "");
  }
  return entries;
}

export function buildAliasArgs(name: string, args?: string[]): string[] {
  const out = [name];
  if (args) for (const a of args) out.push(a);
  return out;
}

export function sanitizeAliasToolName(name: string): string {
  return "worktrunk_alias_" + name.replace(/[^a-zA-Z0-9]+/g, "_");
}

export function summarizeAliasTemplate(template: string, max = 160): string {
  const collapsed = template.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? collapsed.slice(0, max) + "…" : collapsed;
}
