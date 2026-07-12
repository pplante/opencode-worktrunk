export type SwitchResult = {
  action: string;
  branch: string;
  path: string;
  createdBranch: boolean;
  baseBranch?: string;
};

export type ListEntry = {
  branch: string;
  path: string;
  isMain: boolean;
  isCurrent: boolean;
  isPrevious: boolean;
  mainState?: string;
  ahead: number;
  behind: number;
  dirty: boolean;
};

export type MergeResult = {
  branch: string;
  committed: boolean;
  rebased: boolean;
  removed: boolean;
  squashed: boolean;
  target: string;
};

export type RemoveEntry = {
  branch: string;
  branchDeleted: boolean;
  kind: string;
  path: string;
};

function parseJson<T>(stdout: string, name: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (e: any) {
    throw new Error(`${name} failed: ${e.message} (raw output: ${stdout.slice(0, 200)})`);
  }
}

export function parseSwitchResult(stdout: string): SwitchResult {
  const raw = parseJson<{
    action: string;
    branch: string;
    path: string;
    created_branch?: boolean;
    base_branch?: string;
  }>(stdout, "parseSwitchResult");
  return {
    action: raw.action,
    branch: raw.branch,
    path: raw.path,
    createdBranch: raw.created_branch ?? false,
    baseBranch: raw.base_branch,
  };
}

type RawWorkingTree = {
  staged?: boolean;
  modified?: boolean;
  untracked?: boolean;
  renamed?: boolean;
  deleted?: boolean;
};

type RawListEntry = {
  branch: string;
  path: string;
  is_main?: boolean;
  is_current?: boolean;
  is_previous?: boolean;
  main_state?: string;
  working_tree?: RawWorkingTree;
  remote?: { ahead?: number; behind?: number };
  main?: { ahead?: number; behind?: number };
};

function isDirty(wt: RawWorkingTree | undefined): boolean {
  if (!wt) return false;
  return Boolean(wt.modified || wt.staged || wt.untracked || wt.renamed || wt.deleted);
}

export function parseListResult(stdout: string): ListEntry[] {
  const raw = parseJson<RawListEntry[]>(stdout, "parseListResult");
  return raw.map((w) => {
    const sync = w.remote ?? w.main ?? {};
    return {
      branch: w.branch,
      path: w.path,
      isMain: w.is_main ?? false,
      isCurrent: w.is_current ?? false,
      isPrevious: w.is_previous ?? false,
      mainState: w.main_state,
      ahead: sync.ahead ?? 0,
      behind: sync.behind ?? 0,
      dirty: isDirty(w.working_tree),
    };
  });
}

export function parseMergeResult(stdout: string): MergeResult {
  const raw = parseJson<{
    branch: string;
    committed: boolean;
    rebased: boolean;
    removed: boolean;
    squashed: boolean;
    target: string;
  }>(stdout, "parseMergeResult");
  return {
    branch: raw.branch,
    committed: raw.committed,
    rebased: raw.rebased,
    removed: raw.removed,
    squashed: raw.squashed,
    target: raw.target,
  };
}

export function parseRemoveResult(stdout: string): RemoveEntry[] {
  const raw = parseJson<
    Array<{
      branch: string;
      branch_deleted?: boolean;
      kind: string;
      path: string;
    }>
  >(stdout, "parseRemoveResult");
  return raw.map((w) => ({
    branch: w.branch,
    branchDeleted: w.branch_deleted ?? false,
    kind: w.kind,
    path: w.path,
  }));
}
