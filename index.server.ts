import type { PluginServerContext } from "@getpaseo/plugin/server";
import { boardAction, closeBoardConnection, getBoardMeta, moveBoardCard, toggleBoardLabel } from "./server/board";
import { boardActionRpc, boardFilters, getBoardMetaRpc, moveBoardCardRpc, toggleBoardLabelRpc } from "./shared/board";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(boardFilters);
  server.handle(getBoardMetaRpc, ({ projectIds }) => getBoardMeta(projectIds));
  server.handle(moveBoardCardRpc, (input, { paseo }) => moveBoardCard(input, paseo));
  server.handle(toggleBoardLabelRpc, (input, { paseo }) => toggleBoardLabel(input, paseo));
  server.handle(boardActionRpc, (input, { paseo }) => boardAction(input, paseo));
  return () => closeBoardConnection();
}
