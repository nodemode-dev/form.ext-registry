import type { Chapter } from "./chapters";

export interface Op {
  command: string;
  args: Record<string, unknown>;
}

const op = (command: string, args: Record<string, unknown>): Op => ({ command, args });

export const ops = {
  addMarker: (at: number, label: string) => op("add-marker", { at, label }),
  addRegion: (start: number, end: number, label: string) => op("add-region", { start, end, label }),
  rename: (c: Chapter, label: string) => (c.kind === "marker" ? op("set-marker", { markerId: c.refId, label }) : op("set-region", { regionId: c.refId, label })),
  move: (c: Chapter, at: number) => (c.kind === "marker" ? op("set-marker", { markerId: c.refId, at }) : op("set-region", { regionId: c.refId, start: at })),
  remove: (c: Chapter) => (c.kind === "marker" ? op("remove-marker", { markerId: c.refId }) : op("remove-region", { regionId: c.refId })),
};
