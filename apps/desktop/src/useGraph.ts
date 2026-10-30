// Re-renders a component when the vault's link graph changes: its notes'
// links, tags, aliases and headings, as the link index reads them.
import type { LinkGraph } from "@nether/graph";
import { useSyncExternalStore } from "react";

const versions = new WeakMap<LinkGraph, number>();

/** A number that changes whenever the graph does, for what reads it to run again. */
export function useGraph(graph: LinkGraph | undefined): number {
  return useSyncExternalStore(
    (listener) => {
      if (graph === undefined) return () => undefined;
      return graph.subscribe(() => {
        versions.set(graph, (versions.get(graph) ?? 0) + 1);
        listener();
      });
    },
    () => (graph === undefined ? 0 : (versions.get(graph) ?? 0)),
  );
}
