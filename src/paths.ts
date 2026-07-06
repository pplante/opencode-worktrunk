import path from "path";
import { realpathSync } from "fs";

export function isUnderPath(childPath: string, parentPath: string): boolean {
  const rel = path.relative(parentPath, childPath);
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function resolvePath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
