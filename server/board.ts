import type { PaseoApi } from "@getpaseo/client";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type Label = { name: string; color: "violet" | "sky" | "emerald" | "orange" | "pink" | "indigo" | "teal" | "red" | "amber" | "blue" };
type Icon = { data: string; mimeType: string } | null;
type Message = { type: string; payload?: Record<string, unknown> };
type Envelope = { type: string; message?: Message; reason?: string };
type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
};
type Waiter = { expected: string; resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

class BoardBridge {
  private waiters = new Map<string, Waiter>();
  private constructor(private socket: SocketLike) {}

  static async connect(url: string): Promise<BoardBridge> {
    const Socket = (globalThis as unknown as { WebSocket: new (address: string) => SocketLike }).WebSocket;
    const socket = new Socket(url);
    const bridge = new BoardBridge(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to the Paseo daemon")), 15000);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "hello", clientId: `workspace-board-${randomUUID()}`, clientType: "cli", protocolVersion: 1 }));
      });
      socket.addEventListener("message", (event) => {
        const envelope = JSON.parse(String(event.data)) as Envelope;
        if (envelope.type === "hello.rejected") {
          clearTimeout(timer);
          reject(new Error(`Paseo rejected the board connection: ${envelope.reason}`));
          return;
        }
        const message = envelope.message;
        if (message?.type === "status" && message.payload?.status === "server_info") {
          clearTimeout(timer);
          resolve();
        }
        bridge.receive(message);
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not connect to the Paseo daemon"));
      });
      socket.addEventListener("close", () => bridge.failPending());
    });
    return bridge;
  }

  private receive(message: Message | undefined): void {
    const requestId = message?.payload?.requestId;
    if (!message || typeof requestId !== "string") return;
    const waiter = this.waiters.get(requestId);
    if (!waiter) return;
    this.waiters.delete(requestId);
    clearTimeout(waiter.timer);
    if (message.type !== waiter.expected) {
      waiter.reject(new Error(`Unexpected Paseo response: ${message.type}`));
    } else {
      waiter.resolve(message.payload ?? {});
    }
  }

  private failPending(): void {
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Paseo daemon connection closed"));
    }
    this.waiters.clear();
    connection = null;
  }

  request<T>(type: string, expected: string, data: Record<string, unknown> = {}): Promise<T> {
    if (this.socket.readyState !== 1) return Promise.reject(new Error("Paseo daemon connection is not open"));
    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(requestId);
        reject(new Error(`Timed out waiting for ${expected}`));
      }, 15000);
      this.waiters.set(requestId, { expected, resolve: (value) => resolve(value as T), reject, timer });
      this.socket.send(JSON.stringify({ type: "session", message: { type, requestId, ...data } }));
    });
  }

  close(): void {
    this.socket.close();
    this.failPending();
  }
}

let connection: Promise<BoardBridge> | null = null;

async function daemonUrl(): Promise<string> {
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  const config = JSON.parse(await readFile(join(home, "config.json"), "utf8")) as { daemon?: { listen?: string } };
  const listen = config.daemon?.listen || "127.0.0.1:6767";
  const port = listen.slice(listen.lastIndexOf(":") + 1);
  if (!/^\d+$/.test(port)) throw new Error("Could not determine the Paseo daemon port");
  return `ws://127.0.0.1:${port}/ws`;
}

async function bridge(): Promise<BoardBridge> {
  if (!connection) connection = BoardBridge.connect(await daemonUrl()).catch((error) => { connection = null; throw error; });
  return connection;
}

export async function closeBoardConnection(): Promise<void> {
  const current = connection;
  connection = null;
  if (current) (await current).close();
}

async function listLabels(): Promise<Label[]> {
  const result = await (await bridge()).request<{ labels: Label[] }>("workspace.label.list.request", "workspace.label.list.response");
  return result.labels;
}

export async function getBoardMeta(projectIds: string[]) {
  const client = await bridge();
  const labels = await listLabels();
  const icons: Record<string, Icon> = {};
  await Promise.all([...new Set(projectIds)].map(async (projectId) => {
    const response = await client.request<{ icon: Icon; error: string | null }>("project.icon.get.request", "project.icon.get.response", { projectId });
    if (response.error) throw new Error(response.error);
    icons[projectId] = response.icon;
  }));
  return { labels, icons };
}

export async function moveBoardCard(input: { workspaceId: string; fromLabel: string | null; toLabel: string | null }, paseo: PaseoApi) {
  const workspace = await paseo.workspaces.ref(input.workspaceId).refresh();
  if (!workspace) throw new Error("Workspace no longer exists");
  const currentLabels = workspace.labels ?? [];
  if (input.fromLabel && !currentLabels.includes(input.fromLabel)) {
    throw new Error("The workspace labels changed. Refresh the board and try again.");
  }
  const labels = await listLabels();
  const destination = input.toLabel ? labels.find((label) => label.name === input.toLabel) : null;
  if (input.toLabel && !destination) throw new Error("The destination label no longer exists");
  if (input.fromLabel === input.toLabel) return { workspaceId: input.workspaceId, labels: currentLabels };
  const client = await bridge();
  let updated = currentLabels;
  if (destination && !currentLabels.includes(destination.name)) {
    const result = await client.request<{ workspaceLabels: string[] }>("workspace.label.assignment.set.request", "workspace.label.assignment.set.response", { workspaceId: input.workspaceId, label: destination, assigned: true });
    updated = result.workspaceLabels;
  }
  if (input.fromLabel) {
    const source = labels.find((label) => label.name === input.fromLabel);
    if (!source) throw new Error("The source label no longer exists");
    const result = await client.request<{ workspaceLabels: string[] }>("workspace.label.assignment.set.request", "workspace.label.assignment.set.response", { workspaceId: input.workspaceId, label: source, assigned: false });
    updated = result.workspaceLabels;
  }
  return { workspaceId: input.workspaceId, labels: updated };
}

export async function toggleBoardLabel(input: { workspaceId: string; labelName: string; assigned: boolean }, paseo: PaseoApi) {
  const workspace = await paseo.workspaces.ref(input.workspaceId).refresh();
  if (!workspace) throw new Error("Workspace no longer exists");
  const label = (await listLabels()).find((entry) => entry.name === input.labelName);
  if (!label) throw new Error("The label no longer exists");
  const response = await (await bridge()).request<{ workspaceLabels: string[] }>(
    "workspace.label.assignment.set.request", "workspace.label.assignment.set.response",
    { workspaceId: input.workspaceId, label, assigned: input.assigned },
  );
  return { labels: response.workspaceLabels };
}

export async function boardAction(input: { workspaceId: string; action: "pin" | "unpin" | "mark_unread" }, paseo: PaseoApi) {
  const workspace = await paseo.workspaces.ref(input.workspaceId).refresh();
  if (!workspace) throw new Error("Workspace no longer exists");
  const client = await bridge();
  if (input.action === "mark_unread") {
    const result = await client.request<{ success: boolean; error: string | null }>("workspace.mark_unread.request", "workspace.mark_unread.response", { workspaceId: input.workspaceId });
    if (!result.success) throw new Error(result.error || "Could not mark workspace as unread");
  } else {
    const result = await client.request<{ accepted: boolean; error: string | null }>("workspace.pin.set.request", "workspace.pin.set.response", { workspaceId: input.workspaceId, pinned: input.action === "pin" });
    if (!result.accepted) throw new Error(result.error || "Could not change workspace pin");
  }
  return { ok: true };
}
