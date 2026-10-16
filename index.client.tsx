import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { BoardScreen } from "./client/board";
import { rememberBoardOrigin } from "./client/web";

function BoardItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Columns3" active={currentScreen?.screenId === "board"} onPress={() => {
    rememberBoardOrigin();
    openScreen({ screenId: "board" });
  }} />;
}

export default function contribute(client: PluginClientContext) {
  const removeScreen = client.addScreen({ id: "board", title: "Workspace board", Component: BoardScreen });
  const removeSidebar = client.addSidebarHeaderItem({ id: "board", title: "Workspace board", Component: BoardItem });
  const removeCommand = client.addCommandCenterItem({
    id: "open-board",
    title: "Open workspace board",
    icon: "Columns3",
    context: "global",
    onSelect({ openScreen }) {
      rememberBoardOrigin();
      openScreen({ screenId: "board" });
    },
  });
  return () => { removeCommand(); removeSidebar(); removeScreen(); };
}
