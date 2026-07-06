import { isUnderPath, resolvePath } from "./paths";
import type { ListEntry } from "./parse";

export type SidebarRow = {
  branch: string;
  path: string;
  basename: string;
  isMain: boolean;
  active: boolean;
};

export function formatSidebarRows(list: ListEntry[], sessionDirectory: string): SidebarRow[] {
  const session = resolvePath(sessionDirectory);
  return list.map((w) => {
    const resolvedWt = resolvePath(w.path);
    const basename = w.path.split("/").pop() ?? w.path;
    return {
      branch: w.branch,
      path: w.path,
      basename,
      isMain: w.isMain,
      active: isUnderPath(session, resolvedWt),
    };
  });
}
