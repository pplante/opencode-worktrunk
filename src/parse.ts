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

function parseJson<T>(stdout: string, name: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (e: any) {
    throw new Error(
      `${name} failed: ${e.message} (raw output: ${stdout.slice(0, 200)})`
    );
  }
}

export function parseSwitchResult(stdout: string): SwitchResult {
  const raw = parseJson<
    {
      action: string;
      branch: string;
      path: string;
      created_branch?: boolean;
      base_branch?: string;
    }
  >(stdout, "parseSwitchResult");
  return {
    action: raw.action,
    branch: raw.branch,
    path: raw.path,
    createdBranch: raw.created_branch ?? false,
    baseBranch: raw.base_branch,
  };
}

export function parseListResult(stdout: string): ListEntry[] {
  const raw = parseJson<
    Array<{
      branch: string;
      path: string;
      is_main?: boolean;
    }>
  >(stdout, "parseListResult");
  return raw.map((w) => ({
    branch: w.branch,
    path: w.path,
    isMain: w.is_main ?? false,
  }));
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
