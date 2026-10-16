import { Platform } from "react-native";

interface DragElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  closest(selector: string): DragElement | null;
}

interface DragEventLike {
  target: DragElement | null;
  dataTransfer: { setData(type: string, value: string): void; getData(type: string): string; effectAllowed: string; dropEffect: string } | null;
  preventDefault(): void;
}

interface BoardElement {
  querySelectorAll(selector: string): Iterable<DragElement>;
  addEventListener(type: string, handler: (event: DragEventLike) => void): void;
  removeEventListener(type: string, handler: (event: DragEventLike) => void): void;
}

export function installBoardDrag(root: unknown, onMove: (workspaceId: string, label: string) => void): () => void {
  if (Platform.OS !== "web" || !root) return () => {};
  const element = root as BoardElement;
  const cards = element.querySelectorAll('[data-testid^="board-card-"]');
  for (const card of cards) card.setAttribute("draggable", "true");
  const cardId = (event: DragEventLike) => event.target?.closest('[data-testid^="board-card-"]')?.getAttribute("data-testid")?.slice("board-card-".length);
  const columnLabel = (event: DragEventLike) => {
    const encoded = event.target?.closest('[data-testid^="board-column-"]')?.getAttribute("data-testid")?.slice("board-column-".length);
    return encoded ? decodeURIComponent(encoded) : null;
  };
  const start = (event: DragEventLike) => {
    const id = cardId(event);
    if (id && event.dataTransfer) {
      event.dataTransfer.setData("text/plain", id);
      event.dataTransfer.effectAllowed = "move";
    }
  };
  const over = (event: DragEventLike) => {
    if (columnLabel(event)) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    }
  };
  const drop = (event: DragEventLike) => {
    const label = columnLabel(event);
    const id = event.dataTransfer?.getData("text/plain");
    if (label && id) {
      event.preventDefault();
      onMove(id, label);
    }
  };
  element.addEventListener("dragstart", start);
  element.addEventListener("dragover", over);
  element.addEventListener("drop", drop);
  return () => {
    element.removeEventListener("dragstart", start);
    element.removeEventListener("dragover", over);
    element.removeEventListener("drop", drop);
  };
}

declare const window: { history: { back(): void; length: number } };
let boardOpenedFromHost = false;

export function rememberBoardOrigin(): void {
  boardOpenedFromHost = true;
}

export function closeBoard(fallback: () => void): void {
  if (Platform.OS === "web" && boardOpenedFromHost && window.history.length > 1) {
    boardOpenedFromHost = false;
    window.history.back();
    return;
  }
  fallback();
}
