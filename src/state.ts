export type SessionEntry = {
  worktreePath: string;
  branch: string;
};

export function createState() {
  const map = new Map<string, SessionEntry>();
  return {
    get(sessionID: string): SessionEntry | undefined {
      return map.get(sessionID);
    },
    set(sessionID: string, entry: SessionEntry): void {
      map.set(sessionID, entry);
    },
    clear(sessionID: string): void {
      map.delete(sessionID);
    },
  };
}
