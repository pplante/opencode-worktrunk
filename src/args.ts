export type SwitchArgsInput = {
  branch: string;
  create: boolean;
  base?: string;
  noHooks?: boolean;
};

export type MergeArgsInput = {
  target?: string;
  noRemove?: boolean;
  noSquash?: boolean;
  noHooks?: boolean;
};

export type RemoveArgsInput = {
  branch: string;
  noHooks?: boolean;
};

export function buildSwitchArgs(input: SwitchArgsInput): string[] {
  const args = ["switch"];
  if (input.create) args.push("--create");
  if (input.base) args.push("--base", input.base);
  if (input.noHooks) args.push("--no-hooks");
  args.push("--no-cd", "--format", "json", "-y", input.branch);
  return args;
}

export function buildMergeArgs(input: MergeArgsInput): string[] {
  const args = ["merge"];
  if (input.noRemove) args.push("--no-remove");
  if (input.noSquash) args.push("--no-squash");
  if (input.noHooks) args.push("--no-hooks");
  args.push("--format", "json", "-y");
  if (input.target) args.push(input.target);
  return args;
}

export function buildListArgs(): string[] {
  return ["list", "--format", "json", "-y"];
}

export function buildRemoveArgs(input: RemoveArgsInput): string[] {
  const args = ["remove"];
  if (input.noHooks) args.push("--no-hooks");
  args.push("--format", "json", "-y", "--foreground", input.branch);
  return args;
}
