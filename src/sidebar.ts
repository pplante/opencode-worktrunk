import { isUnderPath, resolvePath } from "./paths";
import type { ListEntry } from "./parse";

export type SidebarRow = {
  branch: string;
  path: string;
  status: string;
  isMain: boolean;
  isCurrent: boolean;
  isPrevious: boolean;
  active: boolean;
};

export function statusIcon(
  dirty: boolean,
  ahead: number,
  behind: number,
  integrated: boolean,
): string {
  const parts: string[] = [];
  if (dirty) parts.push("*");
  if (ahead > 0) parts.push(`↑${ahead}`);
  if (behind > 0) parts.push(`↓${behind}`);
  if (integrated) parts.push("✓");
  return parts.join(" ");
}

export function formatSidebarRows(list: ListEntry[], sessionDirectory: string): SidebarRow[] {
  const session = resolvePath(sessionDirectory);
  return list.map((w) => {
    const resolvedWt = resolvePath(w.path);
    const integrated = w.mainState === "integrated";
    return {
      branch: w.branch,
      path: w.path,
      status: statusIcon(w.dirty, w.ahead, w.behind, integrated),
      isMain: w.isMain,
      isCurrent: w.isCurrent,
      isPrevious: w.isPrevious,
      active: isUnderPath(session, resolvedWt),
    };
  });
}

export function partitionRows(rows: SidebarRow[]): {
  current: SidebarRow | null;
  others: SidebarRow[];
} {
  const current = rows.find((r) => r.active) ?? rows.find((r) => r.isCurrent) ?? null;
  const currentIdx = current ? rows.indexOf(current) : -1;
  const others = rows.filter((_, i) => i !== currentIdx);
  return { current, others };
}
