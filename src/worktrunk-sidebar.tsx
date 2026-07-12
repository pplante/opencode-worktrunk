/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { $ } from "bun";
import { buildListArgs } from "./args";
import { parseListResult } from "./parse";
import { formatSidebarRows, partitionRows } from "./sidebar";
import type { SidebarRow } from "./sidebar";
import { createSignal } from "solid-js";

const SINGLE_BORDER = { type: "single" } as any;

const tui: TuiPlugin = async (api) => {
  const projectRoot = api.state.path.worktree;
  const theme = api.theme;
  const [rows, setRows] = createSignal<SidebarRow[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [collapsed, setCollapsed] = createSignal(false);
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
        const all = rows();
        const t = theme.current;
        const { current, others } = partitionRows(all);
        const toggle = () => setCollapsed(!collapsed());
        return (
          <box
            width="100%"
            flexDirection="column"
            border={SINGLE_BORDER}
            borderColor={t.borderActive}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={1}
            paddingRight={1}
          >
            <box flexDirection="row" justifyContent="space-between" alignItems="center">
              <box paddingLeft={1} paddingRight={1} backgroundColor={t.accent}>
                <text fg={t.background}>
                  <b>{"Worktrees"}</b>
                </text>
              </box>
              <text fg={t.textMuted}>{all.length}</text>
            </box>

            {current && (
              <box flexDirection="row" marginTop={1} justifyContent="space-between">
                <box flexDirection="row">
                  <text fg={t.accent}>● </text>
                  <text fg={t.text}>
                    <b>{current.branch}</b>
                  </text>
                </box>
                {current.status.length > 0 && <text fg={t.textMuted}> {current.status}</text>}
              </box>
            )}

            {others.length > 0 && (
              <box flexDirection="column" marginTop={1}>
                <box
                  flexDirection="row"
                  justifyContent="space-between"
                  alignItems="center"
                  onMouseDown={() => toggle()}
                >
                  <text fg={t.textMuted}>
                    <b>{collapsed() ? "▶ " : "▼ "}Other</b>
                  </text>
                  <text fg={t.textMuted}>{others.length}</text>
                </box>

                {!collapsed() && (
                  <box flexDirection="column" marginTop={1}>
                    {others.map((row) => (
                      <box flexDirection="row" justifyContent="space-between">
                        <text fg={t.textMuted}>○ {row.branch}</text>
                        {row.status.length > 0 && <text fg={t.textMuted}> {row.status}</text>}
                      </box>
                    ))}
                  </box>
                )}
              </box>
            )}

            {all.length === 0 && <text fg={t.textMuted}> {error() ? "(error)" : "(none)"}</text>}
          </box>
        );
      },
    },
  });
};

const module: TuiPluginModule = { id: "worktrunk-sidebar", tui };
export default module;
