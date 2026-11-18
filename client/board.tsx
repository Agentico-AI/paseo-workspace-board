import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { getPaseoClient, useHosts, usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { copyText, Modal, TextInput as ModalTextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { boardActionRpc, boardFilters, getBoardMetaRpc, moveBoardCardRpc, toggleBoardLabelRpc } from "../shared/board";
import { closeBoard, installBoardDrag } from "./web";

const COLUMN_WIDTH = 280;
const UNLABELED = "Unlabeled";
type PaseoWorkspace = Awaited<ReturnType<ReturnType<typeof getPaseoClient>["workspaces"]["list"]>>["entries"][number];
type PaseoAgentListResult = Awaited<ReturnType<ReturnType<typeof getPaseoClient>["agents"]["list"]>>;
type BoardWorkspace = PaseoWorkspace & { serverId: string; hostLabel: string };
const cardKey = (workspace: BoardWorkspace) => JSON.stringify([workspace.serverId, workspace.id]);
const projectKey = (workspace: BoardWorkspace) => JSON.stringify([workspace.serverId, workspace.projectId]);
const labelColors: Record<string, string> = {
  violet: "#A78BFA", sky: "#38BDF8", emerald: "#34D399", orange: "#FB923C", pink: "#F472B6",
  indigo: "#818CF8", teal: "#2DD4BF", red: "#F87171", amber: "#FBBF24", blue: "#60A5FA",
};
const groups = [
  { id: "pinned", title: "Pinned" },
  { id: "needs_input", title: "Needs input" },
  { id: "failed", title: "Error" },
  { id: "running", title: "Working" },
  { id: "attention", title: "Ready to review" },
  { id: "done", title: "Done" },
] as const;

function primaryLabel(workspace: PaseoWorkspace): string {
  return workspace.labels?.[0] || UNLABELED;
}

function workspaceTitle(workspace: PaseoWorkspace): string {
  return workspace.title?.trim() || workspace.name;
}

function groupWorkspaces(workspaces: BoardWorkspace[], group: (typeof groups)[number]["id"]): BoardWorkspace[] {
  if (group === "pinned") return workspaces.filter((workspace) => Boolean(workspace.pinnedAt));
  return workspaces.filter((workspace) => !workspace.pinnedAt && workspace.status === group);
}

function relativeActivity(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const elapsed = Math.max(0, now - Date.parse(iso));
  if (!Number.isFinite(elapsed)) return "";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function hostInk(label: string, background: string, fallback: string): string {
  const hex = background.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!label.trim()) return fallback;
  const brightness = hex ? (parseInt(hex.slice(0, 2), 16) * 299 + parseInt(hex.slice(2, 4), 16) * 587 + parseInt(hex.slice(4, 6), 16) * 114) / 1000 : 0;
  const dark = brightness < 128;
  if (label.toLowerCase().includes("agentico")) return dark ? "#6cae96" : "#3e6e5d";
  if (label.toLowerCase().includes("consuite")) return dark ? "#6aa6ce" : "#3d6985";
  const darkColors = ["#a392d5", "#6aa6ce", "#6cae96", "#cc8f64", "#d87da3", "#9299d5", "#6cacab", "#d88381", "#b29d64", "#7ba1d5"];
  const lightColors = ["#6d49b5", "#3d6985", "#3e6e5d", "#845838", "#974168", "#5251c2", "#3e6d6c", "#9c4243", "#716239", "#39649e"];
  let hash = 0;
  for (const character of label) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (dark ? darkColors : lightColors)[hash % darkColors.length];
}

export function BoardScreen({ theme, layout, navigation, host }: PluginScreenProps) {
  const paseo = usePaseo();
  const hosts = useHosts();
  const settings = useSettings(boardFilters);
  const [openFilter, setOpenFilter] = useState<"hosts" | "projects" | null>(null);
  const [showSaveView, setShowSaveView] = useState(false);
  const [draftViewName, setDraftViewName] = useState("");
  const hostIds = settings.status === "ready" ? settings.values.hostIds : [];
  const projectKeys = settings.status === "ready" ? settings.values.projectKeys : [];
  const savedViews = settings.status === "ready" ? settings.values.views : [];
  const activeViewId = settings.status === "ready" ? settings.values.activeViewId : null;
  const onlineHosts = useMemo(() => hosts.filter((entry) => entry.status === "online"), [hosts]);
  const hostSignature = onlineHosts.map((entry) => `${entry.serverId}:${entry.label}`).join("|");
  const getMeta = useRpc(getBoardMetaRpc);
  const moveCard = useRpc(moveBoardCardRpc);
  const toggleLabel = useRpc(toggleBoardLabelRpc);
  const runBoardAction = useRpc(boardActionRpc);
  const queryClient = useQueryClient();
  const boardRef = useRef<View>(null);
  const [search, setSearch] = useState("");
  const [moving, setMoving] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuPage, setMenuPage] = useState<"main" | "labels" | "rename" | "archive">("main");
  const [draftTitle, setDraftTitle] = useState("");
  const [menuBusy, setMenuBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const workspaces = useQuery({
    queryKey: ["workspace-board", "workspaces", hostSignature],
    refetchInterval: 10000,
    queryFn: async () => {
      const loadHost = async (serverId: string, hostLabel: string): Promise<BoardWorkspace[]> => {
      const client = serverId === host.id ? paseo : getPaseoClient(serverId);
      const entries: PaseoWorkspace[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.workspaces.list({ page: { limit: 100, cursor } });
        entries.push(...page.entries);
        cursor = page.pageInfo.nextCursor ?? undefined;
      } while (cursor);
      const activityByWorkspace = new Map<string, string>();
      const workspaceByDirectory = new Map(entries.map((workspace) => [workspace.workspaceDirectory?.toLowerCase(), workspace.id]));
      cursor = undefined;
      do {
        const page: PaseoAgentListResult = await client.agents.list({ page: { limit: 100, cursor }, scope: "active" });
        for (const { agent } of page.entries) {
          const workspaceId = agent.workspaceId || workspaceByDirectory.get(agent.cwd.toLowerCase());
          if (!workspaceId) continue;
          const previous = activityByWorkspace.get(workspaceId);
          if (!previous || Date.parse(agent.updatedAt) > Date.parse(previous)) activityByWorkspace.set(workspaceId, agent.updatedAt);
        }
        cursor = page.pageInfo.nextCursor ?? undefined;
      } while (cursor);
      return entries.map((workspace) => {
        const agentActivity = activityByWorkspace.get(workspace.id);
        return {
          ...workspace,
          serverId,
          hostLabel,
          activityAt: [workspace.activityAt, agentActivity, workspace.statusEnteredAt]
            .filter((value): value is string => Boolean(value))
            .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
        };
      });
      };
      const targets = onlineHosts.length ? onlineHosts : [{ serverId: host.id, label: host.label }];
      const results = await Promise.allSettled(targets.map((entry) => loadHost(entry.serverId, entry.label)));
      const loaded = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      if (!loaded.length && results.some((result) => result.status === "rejected")) {
        throw new Error(results.filter((result) => result.status === "rejected").map((result) => String(result.reason)).join("; "));
      }
      return loaded;
    },
  });
  const projectIds = useMemo(() => [...new Set((workspaces.data ?? []).filter((workspace) => workspace.serverId === host.id).map((workspace) => workspace.projectId))], [workspaces.data, host.id]);
  const meta = useQuery({
    queryKey: ["workspace-board", "meta", projectIds.join("|")],
    queryFn: () => getMeta({ projectIds }),
    enabled: Boolean(workspaces.data),
    refetchInterval: 60000,
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (workspaces.data ?? [])
      .filter((workspace) => !hostIds.length || hostIds.includes(workspace.serverId))
      .filter((workspace) => !projectKeys.length || projectKeys.includes(projectKey(workspace)))
      .filter((workspace) => !term || [workspaceTitle(workspace), workspace.projectDisplayName, ...(workspace.labels ?? [])]
        .some((value) => value.toLowerCase().includes(term)))
      .sort((a, b) => (Date.parse(b.activityAt ?? "") || 0) - (Date.parse(a.activityAt ?? "") || 0));
  }, [search, workspaces.data, hostIds.join("|"), projectKeys.join("|")]);
  const projects = useMemo(() => {
    const choices = new Map<string, { key: string; title: string; projectId: string; serverId: string; displayName: string }>();
    for (const workspace of workspaces.data ?? []) {
      const key = projectKey(workspace);
      if (!choices.has(key)) choices.set(key, { key, title: `${workspace.projectDisplayName} (${workspace.hostLabel})`, projectId: workspace.projectId, serverId: workspace.serverId, displayName: workspace.projectDisplayName });
    }
    return [...choices.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [workspaces.data]);
  const columns = useMemo(() => {
    const labels = new Set(filtered.map(primaryLabel));
    return [...labels].sort((a, b) => a === UNLABELED ? 1 : b === UNLABELED ? -1 : a.localeCompare(b));
  }, [filtered]);
  const colorByLabel = useMemo(() => Object.fromEntries((meta.data?.labels ?? []).map((label) => [label.name, labelColors[label.color]])), [meta.data]);
  const selected = workspaces.data?.find((workspace) => cardKey(workspace) === selectedId);

  function saveSettings(values: Parameters<typeof settings.save>[0]) {
    if (settings.status !== "ready" || settings.saving) return;
    void settings.save(values, settings.revision);
  }

  function saveFilter(field: "hostIds" | "projectKeys", value: string[]) {
    if (settings.status !== "ready") return;
    saveSettings({ ...settings.values, [field]: value, activeViewId: null });
  }

  function applyView(view: (typeof savedViews)[number] | null) {
    if (settings.status !== "ready") return;
    saveSettings({ ...settings.values, hostIds: view?.hostIds ?? [], projectKeys: view?.projectKeys ?? [], activeViewId: view?.id ?? null });
    setOpenFilter(null);
  }

  function saveView() {
    if (settings.status !== "ready" || !draftViewName.trim()) return;
    const view = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: draftViewName.trim(), hostIds: [...hostIds], projectKeys: [...projectKeys] };
    saveSettings({ ...settings.values, views: [...settings.values.views, view], activeViewId: view.id });
    setDraftViewName("");
    setShowSaveView(false);
  }

  function removeView(id: string) {
    if (settings.status !== "ready") return;
    saveSettings({ ...settings.values, views: settings.values.views.filter((view) => view.id !== id), activeViewId: activeViewId === id ? null : activeViewId });
  }

  function openMenu(workspace: BoardWorkspace) {
    setSelectedId(cardKey(workspace));
    setMenuPage("main");
    setDraftTitle(workspaceTitle(workspace));
    setMoveError(null);
  }

  async function menuTask(task: () => Promise<unknown>, close = true) {
    setMenuBusy(true);
    setMoveError(null);
    try {
      await task();
      await queryClient.invalidateQueries({ queryKey: ["workspace-board", "workspaces"] });
      if (close) setSelectedId(null);
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : String(error));
    } finally {
      setMenuBusy(false);
    }
  }

  async function changeLabel(workspaceId: string, target: string) {
    const workspace = workspaces.data?.find((entry) => cardKey(entry) === workspaceId);
    if (!workspace || workspace.serverId !== host.id || moving) return;
    const fromLabel = primaryLabel(workspace);
    if (fromLabel === target) return;
    setMoving(workspaceId);
    setMoveError(null);
    try {
      await moveCard({ workspaceId: workspace.id, fromLabel: fromLabel === UNLABELED ? null : fromLabel, toLabel: target === UNLABELED ? null : target });
      await queryClient.invalidateQueries({ queryKey: ["workspace-board", "workspaces"] });
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : String(error));
    } finally {
      setMoving(null);
    }
  }

  useEffect(() => installBoardDrag(boardRef.current, (workspaceId, label) => void changeLabel(workspaceId, label)), [workspaces.data, columns, moving]);

  const styles = useMemo(() => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    toolbar: { padding: layout.compact ? 12 : 20, gap: 10, zIndex: 100, elevation: 100, backgroundColor: theme.colors.surface0 },
    title: { color: theme.colors.foreground, fontSize: layout.compact ? 23 : 29, fontWeight: "800" as const },
    toolbarTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
    closeButton: { paddingHorizontal: 10, paddingVertical: 3 },
    closeText: { color: theme.colors.foregroundMuted, fontSize: 26, lineHeight: 30 },
    subtitle: { color: theme.colors.foregroundMuted, fontSize: 13 },
    search: { color: theme.colors.foreground, backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, width: layout.compact ? "100%" as const : 400, alignSelf: "flex-end" as const },
    filterRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, justifyContent: "flex-end" as const, gap: 8, zIndex: 100, elevation: 100 },
    filterControl: { width: layout.compact ? 160 : 190, position: "relative" as const },
    filterButton: { backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
    filterButtonText: { color: theme.colors.foreground, fontSize: 13 },
    filterMenu: { position: "absolute" as const, top: "100%" as const, right: 0, width: 280, backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, maxHeight: 260, zIndex: 200, elevation: 200 },
    filterOption: { paddingHorizontal: 12, paddingVertical: 8, borderBottomColor: theme.colors.border, borderBottomWidth: 1, flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    filterOptionText: { color: theme.colors.foreground, fontSize: 13 },
    filterCheck: { color: theme.colors.foregroundMuted, width: 14, fontSize: 13 },
    viewRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, justifyContent: "flex-end" as const, gap: 6, alignItems: "center" as const, zIndex: 90 },
    viewPill: { flexDirection: "row" as const, alignItems: "center" as const, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 14, backgroundColor: theme.colors.surface1, paddingHorizontal: 10, paddingVertical: 5, gap: 7 },
    viewPillActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.surface2 },
    viewPillText: { color: theme.colors.foreground, fontSize: 12 },
    viewPillRemove: { color: theme.colors.foregroundMuted, fontSize: 15 },
    saveControl: { position: "relative" as const },
    saveMenu: { position: "absolute" as const, top: "100%" as const, right: 0, width: 245, padding: 10, gap: 8, backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, zIndex: 200, elevation: 200 },
    saveInput: { color: theme.colors.foreground, backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: 1, padding: 8 },
    saveActions: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: 8 },
    projectChoiceIcon: { width: 20, height: 20, borderRadius: 4 },
    projectChoiceFallback: { width: 20, height: 20, borderRadius: 4, backgroundColor: theme.colors.surface2, alignItems: "center" as const, justifyContent: "center" as const },
    projectChoiceInitial: { color: theme.colors.foreground, fontSize: 11, fontWeight: "700" as const },
    countRight: { color: theme.colors.foregroundMuted, fontSize: 13, textAlign: "right" as const },
    error: { color: theme.colors.statusDanger, fontSize: 13 },
    columns: { paddingHorizontal: layout.compact ? 12 : 20, paddingBottom: 24, gap: 10 },
    column: { width: COLUMN_WIDTH, height: "100%" as const, padding: 10, backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1 },
    columnHeader: {
      backgroundColor: theme.colors.surface1,
      borderBottomColor: theme.colors.border,
      borderBottomWidth: 1,
      paddingTop: 8,
      paddingBottom: 10,
      zIndex: 10,
      elevation: 10,
    },
    columnHeaderRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    labelDot: { width: 10, height: 10, borderRadius: 5 },
    columnTitle: { color: theme.colors.foreground, fontSize: 17, fontWeight: "700" as const },
    count: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 3 },
    group: { gap: 7 },
    groupTitle: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "700" as const },
    card: { backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: 1, borderLeftWidth: 3, padding: 10, gap: 7 },
    cardHead: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8 },
    cardOpen: { flex: 1, flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8 },
    cardSide: { alignItems: "center" as const, gap: 2 },
    menuTrigger: { paddingHorizontal: 5, paddingVertical: 1 },
    menuTriggerText: { color: theme.colors.foregroundMuted, fontSize: 20, lineHeight: 23 },
    projectIcon: { width: 25, height: 25, borderRadius: 5 },
    projectFallback: { width: 25, height: 25, borderRadius: 5, backgroundColor: theme.colors.surface2, alignItems: "center" as const, justifyContent: "center" as const },
    projectInitial: { color: theme.colors.foreground, fontSize: 13, fontWeight: "700" as const },
    cardText: { flex: 1, gap: 4 },
    cardTitle: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
    activity: { color: theme.colors.statusSuccess, fontSize: 11 },
    cardMeta: { color: theme.colors.foregroundMuted, fontSize: 11 },
    menuHeading: { color: theme.colors.foreground, fontSize: 15, fontWeight: "700" as const, marginBottom: 4 },
    menuOption: { paddingVertical: 10, paddingHorizontal: 8, borderColor: theme.colors.border, borderBottomWidth: 1 },
    menuOptionText: { color: theme.colors.foreground, fontSize: 14 },
    menuDanger: { color: theme.colors.statusDanger, fontSize: 14 },
    menuInput: { color: theme.colors.foreground, borderColor: theme.colors.border, borderWidth: 1, padding: 8 },
    menuActions: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: 10 },
    empty: { color: theme.colors.foregroundMuted, fontSize: 13, padding: 12 },
  }), [theme, layout.compact]);

  return (
    <View ref={boardRef} style={styles.screen}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarTitleRow}>
          <Text style={styles.title}>Workspace board</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close workspace board" onPress={() => closeBoard(() => {
            const latest = filtered[0];
            if (latest) navigation?.openWorkspace({ workspaceId: latest.id, serverId: latest.serverId });
          })} style={styles.closeButton}>
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>Native label columns, grouped by Paseo status. Drag cards between columns to relabel them.</Text>
        <TextInput
          accessibilityLabel="Search workspaces"
          placeholder="Search workspaces, projects, or labels"
          placeholderTextColor={theme.colors.foregroundMuted}
          value={search}
          onChangeText={setSearch}
          style={styles.search}
        />
        <View style={styles.filterRow}>
          <View style={[styles.filterControl, openFilter === "hosts" ? { zIndex: 2 } : null]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Filter by host" accessibilityState={{ expanded: openFilter === "hosts" }} onPress={() => { setOpenFilter(openFilter === "hosts" ? null : "hosts"); setShowSaveView(false); }} style={styles.filterButton}>
              <Text style={styles.filterButtonText}>Hosts: {hostIds.length ? `${hostIds.length} selected` : "All"}  {openFilter === "hosts" ? "▴" : "▾"}</Text>
            </Pressable>
            {openFilter === "hosts" ? <ScrollView style={styles.filterMenu} nestedScrollEnabled>
              <Pressable accessibilityRole="button" onPress={() => saveFilter("hostIds", [])} style={styles.filterOption}><Text style={styles.filterCheck}>{hostIds.length ? "○" : "✓"}</Text><Text style={styles.filterOptionText}>All hosts</Text></Pressable>
              {hosts.map((entry) => <Pressable key={entry.serverId} accessibilityRole="checkbox" accessibilityState={{ checked: hostIds.includes(entry.serverId), disabled: settings.saving || settings.status !== "ready" }} onPress={() => saveFilter("hostIds", hostIds.includes(entry.serverId) ? hostIds.filter((id) => id !== entry.serverId) : [...hostIds, entry.serverId])} style={styles.filterOption}>
                <Text style={styles.filterCheck}>{hostIds.includes(entry.serverId) ? "✓" : "○"}</Text><Text style={[styles.filterOptionText, { color: hostInk(entry.label, theme.colors.surface0, theme.colors.foregroundMuted) }]}>{entry.label}{entry.status === "online" ? "" : " (offline)"}</Text>
              </Pressable>)}
            </ScrollView> : null}
          </View>
          <View style={[styles.filterControl, openFilter === "projects" ? { zIndex: 2 } : null]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Filter by project" accessibilityState={{ expanded: openFilter === "projects" }} onPress={() => { setOpenFilter(openFilter === "projects" ? null : "projects"); setShowSaveView(false); }} style={styles.filterButton}>
              <Text style={styles.filterButtonText}>Projects: {projectKeys.length ? `${projectKeys.length} selected` : "All"}  {openFilter === "projects" ? "▴" : "▾"}</Text>
            </Pressable>
            {openFilter === "projects" ? <ScrollView style={styles.filterMenu} nestedScrollEnabled>
              <Pressable accessibilityRole="button" onPress={() => saveFilter("projectKeys", [])} style={styles.filterOption}><Text style={styles.filterCheck}>{projectKeys.length ? "○" : "✓"}</Text><Text style={styles.filterOptionText}>All projects</Text></Pressable>
              {projects.map((entry) => <Pressable key={entry.key} accessibilityRole="checkbox" accessibilityState={{ checked: projectKeys.includes(entry.key), disabled: settings.saving || settings.status !== "ready" }} onPress={() => saveFilter("projectKeys", projectKeys.includes(entry.key) ? projectKeys.filter((key) => key !== entry.key) : [...projectKeys, entry.key])} style={styles.filterOption}>
                <Text style={styles.filterCheck}>{projectKeys.includes(entry.key) ? "✓" : "○"}</Text>
                {entry.serverId === host.id && meta.data?.icons[entry.projectId] ? <Image source={{ uri: `data:${meta.data.icons[entry.projectId]!.mimeType};base64,${meta.data.icons[entry.projectId]!.data}` }} style={styles.projectChoiceIcon} /> : <View style={styles.projectChoiceFallback}><Text style={styles.projectChoiceInitial}>{entry.displayName.slice(0, 1).toUpperCase()}</Text></View>}
                <Text style={[styles.filterOptionText, { flexShrink: 1 }]} numberOfLines={1}>{entry.title}</Text>
              </Pressable>)}
            </ScrollView> : null}
          </View>
        </View>
        <View style={styles.viewRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="View all workspaces" onPress={() => applyView(null)} style={[styles.viewPill, !hostIds.length && !projectKeys.length ? styles.viewPillActive : null]}><Text style={styles.viewPillText}>View all</Text></Pressable>
          {savedViews.map((view) => <View key={view.id} style={[styles.viewPill, activeViewId === view.id ? styles.viewPillActive : null]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${view.name} view`} onPress={() => applyView(view)}><Text style={styles.viewPillText}>{view.name}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${view.name} view`} onPress={() => removeView(view.id)}><Text style={styles.viewPillRemove}>×</Text></Pressable>
          </View>)}
          <View style={[styles.saveControl, showSaveView ? { zIndex: 2 } : null]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Save current view" onPress={() => { setShowSaveView(!showSaveView); setOpenFilter(null); }} style={styles.viewPill}><Text style={styles.viewPillText}>+ Save view</Text></Pressable>
            {showSaveView ? <View style={styles.saveMenu}>
              <TextInput accessibilityLabel="View name" placeholder="View name" placeholderTextColor={theme.colors.foregroundMuted} value={draftViewName} onChangeText={setDraftViewName} style={styles.saveInput} />
              <View style={styles.saveActions}>
                <Pressable accessibilityRole="button" onPress={() => setShowSaveView(false)}><Text style={styles.viewPillText}>Cancel</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={!draftViewName.trim() || settings.saving} onPress={saveView}><Text style={[styles.viewPillText, { color: theme.colors.accent }]}>Save</Text></Pressable>
              </View>
            </View> : null}
          </View>
        </View>
        <Text style={styles.countRight}>{workspaces.isLoading ? "Loading workspaces..." : `${filtered.length} workspaces`}</Text>
        {settings.status === "error" || settings.status === "invalid" ? <Text style={styles.error}>Could not load saved filters: {settings.error}</Text> : null}
        {settings.saveError ? <Text style={styles.error}>Could not save filters: {settings.saveError}</Text> : null}
        {workspaces.error ? <Text style={styles.error}>Could not load workspaces: {String(workspaces.error)}</Text> : null}
        {meta.error ? <Text style={styles.error}>Could not load label colors or project icons: {String(meta.error)}</Text> : null}
        {moveError ? <Text style={styles.error}>Could not change label: {moveError}</Text> : null}
      </View>
      <ScrollView horizontal style={styles.screen} contentContainerStyle={styles.columns}>
        {columns.length === 0 && !workspaces.isLoading ? <Text style={styles.empty}>No matching workspaces.</Text> : null}
        {columns.map((label) => {
          const items = filtered.filter((workspace) => primaryLabel(workspace) === label);
          return (
            <View
              key={label}
              testID={`board-column-${encodeURIComponent(label)}`}
              style={[styles.column, { borderTopColor: colorByLabel[label] ?? theme.colors.border, borderTopWidth: 4 }]}
            >
              <View style={styles.columnHeader}>
                <View style={styles.columnHeaderRow}>
                  <View style={[styles.labelDot, { backgroundColor: colorByLabel[label] ?? theme.colors.foregroundMuted }]} />
                  <Text style={styles.columnTitle}>{label}</Text>
                </View>
                <Text style={styles.count}>{items.length} workspaces</Text>
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 18, paddingTop: 10 }}>
              {groups.map((group) => {
                const members = groupWorkspaces(items, group.id);
                if (members.length === 0) return null;
                return (
                  <View key={group.id} style={styles.group}>
                    <Text style={styles.groupTitle}>{group.title} · {members.length}</Text>
                    {members.map((workspace) => {
                      const icon = workspace.serverId === host.id ? meta.data?.icons[workspace.projectId] : null;
                      return <View
                        key={cardKey(workspace)}
                        testID={`${workspace.serverId === host.id ? "board-card-" : "board-remote-card-"}${cardKey(workspace)}`}
                        style={[styles.card, { borderLeftColor: colorByLabel[label] ?? theme.colors.accent }]}
                      >
                        <View style={styles.cardHead}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Open ${workspaceTitle(workspace)}`}
                            onPress={() => navigation?.openWorkspace({ workspaceId: workspace.id, serverId: workspace.serverId })}
                            style={styles.cardOpen}
                          >
                            {icon ? (
                              <Image source={{ uri: `data:${icon.mimeType};base64,${icon.data}` }} style={styles.projectIcon} accessibilityLabel={`${workspace.projectDisplayName} icon`} />
                            ) : (
                              <View style={styles.projectFallback}>
                                <Text style={styles.projectInitial}>{workspace.projectDisplayName.slice(0, 1).toUpperCase()}</Text>
                              </View>
                            )}
                            <View style={styles.cardText}>
                              <Text style={styles.cardTitle} numberOfLines={2}>{workspaceTitle(workspace)}</Text>
                              <Text style={styles.cardMeta} numberOfLines={1}>{workspace.projectDisplayName} · {workspace.hostLabel}</Text>
                            </View>
                          </Pressable>
                          <View style={styles.cardSide}>
                            <Pressable accessibilityRole="button" accessibilityLabel={`More options for ${workspaceTitle(workspace)}`} onPress={() => openMenu(workspace)} style={styles.menuTrigger}>
                              <Text style={styles.menuTriggerText}>⋮</Text>
                            </Pressable>
                            {workspace.activityAt ? <Text style={styles.activity}>{relativeActivity(workspace.activityAt, now)}</Text> : null}
                          </View>
                        </View>
                      </View>;
                    })}
                  </View>
                );
              })}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>
      <Modal title={selected ? workspaceTitle(selected) : "Workspace"} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <Modal.Content contentContainerStyle={{ padding: 12, gap: 8 }}>
          {selected ? (
            <View>
              {menuPage === "main" ? (
                <View>
                  {[
                    { title: "Copy path", run: () => void menuTask(() => copyText(selected.workspaceDirectory || selected.projectRootPath)) },
                    ...(selected.gitRuntime?.currentBranch ? [{ title: "Copy branch name", run: () => void menuTask(() => copyText(selected.gitRuntime?.currentBranch || "")) }] : []),
                    { title: "Rename workspace", run: () => setMenuPage("rename") },
                    ...(selected.serverId === host.id ? [
                      { title: "Mark as unread", run: () => void menuTask(() => runBoardAction({ workspaceId: selected.id, action: "mark_unread" })) },
                      { title: selected.pinnedAt ? "Unpin" : "Pin to top", run: () => void menuTask(() => runBoardAction({ workspaceId: selected.id, action: selected.pinnedAt ? "unpin" : "pin" })) },
                      { title: "Labels", run: () => setMenuPage("labels") },
                    ] : []),
                    { title: "Archive", run: () => setMenuPage("archive"), danger: true },
                  ].map((item) => (
                    <Pressable key={item.title} accessibilityRole="button" disabled={menuBusy} onPress={item.run} style={styles.menuOption}>
                      <Text style={item.danger ? styles.menuDanger : styles.menuOptionText}>{item.title}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {menuPage === "labels" ? (
                <View>
                  {(meta.data?.labels ?? []).map((label) => (
                    <Pressable
                      key={label.name}
                      accessibilityRole="button"
                      disabled={menuBusy}
                      onPress={() => void menuTask(() => toggleLabel({ workspaceId: selected.id, labelName: label.name, assigned: !selected.labels?.includes(label.name) }), false)}
                      style={styles.menuOption}
                    >
                      <Text style={[styles.menuOptionText, { color: labelColors[label.color] }]}>{selected.labels?.includes(label.name) ? "✓ " : "○ "}{label.name}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {menuPage === "rename" ? (
                <ModalTextInput accessibilityLabel="Workspace name" value={draftTitle} onChangeText={setDraftTitle} style={styles.menuInput} autoFocus />
              ) : null}
              {menuPage === "archive" ? <Text style={styles.menuOptionText}>Archive this workspace?</Text> : null}
              {moveError ? <Text style={styles.error}>{moveError}</Text> : null}
              {menuPage !== "main" ? (
                <View style={styles.menuActions}>
                  <Pressable accessibilityRole="button" onPress={() => setMenuPage("main")} style={styles.menuOption}><Text style={styles.menuOptionText}>Back</Text></Pressable>
                  {menuPage === "rename" ? (
                    <Pressable accessibilityRole="button" disabled={menuBusy || !draftTitle.trim()} onPress={() => void menuTask(() => (selected.serverId === host.id ? paseo : getPaseoClient(selected.serverId)).workspaces.ref(selected.id).setTitle(draftTitle.trim()))} style={styles.menuOption}>
                      <Text style={styles.menuOptionText}>{menuBusy ? "Saving..." : "Save"}</Text>
                    </Pressable>
                  ) : null}
                  {menuPage === "archive" ? (
                    <Pressable accessibilityRole="button" disabled={menuBusy} onPress={() => void menuTask(async () => {
                      const result = await (selected.serverId === host.id ? paseo : getPaseoClient(selected.serverId)).workspaces.archive(selected.id);
                      if (result.error) throw new Error(result.error);
                    })} style={styles.menuOption}>
                      <Text style={styles.menuDanger}>{menuBusy ? "Archiving..." : "Archive"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </Modal.Content>
      </Modal>
    </View>
  );
}
