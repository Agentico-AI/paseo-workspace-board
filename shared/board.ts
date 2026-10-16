import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const labelColor = z.enum(["violet", "sky", "emerald", "orange", "pink", "indigo", "teal", "red", "amber", "blue"]);

export const boardFilters = defineSettings({
  id: "board-filters",
  scope: "host",
  version: 2,
  schema: z.object({
    hostIds: z.array(z.string()).default([]),
    projectKeys: z.array(z.string()).default([]),
    views: z.array(z.object({ id: z.string(), name: z.string(), hostIds: z.array(z.string()), projectKeys: z.array(z.string()) })).default([]),
    activeViewId: z.string().nullable().default(null),
  }),
  migrate: (values) => ({ ...((values && typeof values === "object") ? values : {}), views: [], activeViewId: null }),
});

export const getBoardMetaRpc = defineRpc({
  name: "workspace-board.meta.get",
  input: z.object({ projectIds: z.array(z.string()).max(100) }),
  output: z.object({
    labels: z.array(z.object({ name: z.string(), color: labelColor })),
    icons: z.record(z.string(), z.object({ data: z.string(), mimeType: z.string() }).nullable()),
  }),
});

export const moveBoardCardRpc = defineRpc({
  name: "workspace-board.card.move",
  input: z.object({ workspaceId: z.string().min(1), fromLabel: z.string().nullable(), toLabel: z.string().nullable() }),
  output: z.object({ workspaceId: z.string(), labels: z.array(z.string()) }),
});

export const toggleBoardLabelRpc = defineRpc({
  name: "workspace-board.label.toggle",
  input: z.object({ workspaceId: z.string().min(1), labelName: z.string().min(1), assigned: z.boolean() }),
  output: z.object({ labels: z.array(z.string()) }),
});

export const boardActionRpc = defineRpc({
  name: "workspace-board.action",
  input: z.object({ workspaceId: z.string().min(1), action: z.enum(["pin", "unpin", "mark_unread"]) }),
  output: z.object({ ok: z.boolean() }),
});

export type BoardLabel = z.output<typeof getBoardMetaRpc.output>["labels"][number];
