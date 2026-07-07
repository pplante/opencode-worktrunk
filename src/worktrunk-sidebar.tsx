/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { $ } from "bun";
import { buildListArgs } from "./args";
import { parseListResult } from "./parse";
import { formatSidebarRows } from "./sidebar";
import type { SidebarRow } from "./sidebar";
import { createSignal } from "solid-js";

const tui: TuiPlugin = async (api) => {
  const projectRoot = api.state.path.worktree;
  const theme = api.theme;
  const [rows, setRows] = createSignal<SidebarRow[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  let refreshing = false;

  async function runWtList(): Promise<string> {
    try {
      return await $`wt -C ${projectRoot} ${buildListArgs()}`.quiet().text();
    } catch (err: any) {
      const stderr = err.stderr || err.stdout || err.message || "";
      throw new Error(`wt list failed (exit ${err.exitCode}): ${stderr.trim()}`);
    }
  }

  async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      const stdout = await runWtList();
      const list = parseListResult(stdout);
      const sessionDirectory = api.state.path.directory;
      setRows(formatSidebarRows(list, sessionDirectory));
      setError(null);
    } catch (err: any) {
      setError(err.message);
      console.error("[worktrunk-sidebar] refresh failed:", err.message);
    } finally {
      refreshing = false;
    }
  }

  await refresh();

  const offEvent = api.event.on("session.updated", () => {
    void refresh();
  });

  const interval = setInterval(() => {
    void refresh();
  }, 10_000);

  api.lifecycle.onDispose(() => {
    offEvent();
    clearInterval(interval);
  });

  api.slots.register({
    slots: {
      sidebar_content: () => {
        const current = rows();
        const muted = theme.current.textMuted;
        return (
          <box flexDirection="column">
            <text fg={muted}>Worktrees</text>
            {current.length === 0 ? (
              <text fg={muted}> {error() ? "(error)" : "(none)"}</text>
            ) : (
              current.map((row) => (
                <box flexDirection="column">
                  <text>
                    {row.active ? "● " : "○ "}
                    {row.branch}
                  </text>
                  <text fg={muted}> {row.basename}</text>
                </box>
              ))
            )}
          </box>
        );
      },
    },
  });
};

const module: TuiPluginModule = { id: "worktrunk-sidebar", tui };
export default module;
