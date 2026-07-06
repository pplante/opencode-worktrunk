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

export function parseSwitchResult(stdout: string): SwitchResult {
  const raw = JSON.parse(stdout) as {
    action: string;
    branch: string;
    path: string;
    created_branch?: boolean;
    base_branch?: string;
  };
  return {
    action: raw.action,
    branch: raw.branch,
    path: raw.path,
    createdBranch: raw.created_branch ?? false,
    baseBranch: raw.base_branch,
  };
}

export function parseListResult(stdout: string): ListEntry[] {
  const raw = JSON.parse(stdout) as Array<{
    branch: string;
    path: string;
    is_main?: boolean;
  }>;
  return raw.map((w) => ({
    branch: w.branch,
    path: w.path,
    isMain: w.is_main ?? false,
  }));
}

export function parseMergeResult(stdout: string): MergeResult {
  const raw = JSON.parse(stdout) as {
    branch: string;
    committed: boolean;
    rebased: boolean;
    removed: boolean;
    squashed: boolean;
    target: string;
  };
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
  const raw = JSON.parse(stdout) as Array<{
    branch: string;
    branch_deleted?: boolean;
    kind: string;
    path: string;
  }>;
  return raw.map((w) => ({
    branch: w.branch,
    branchDeleted: w.branch_deleted ?? false,
    kind: w.kind,
    path: w.path,
  }));
}
