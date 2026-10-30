// Nether does not ship elkjs (ADR 0009). Mermaid loads this module only to
// draw a diagram that asks for the ELK layout, which then shows this error.
export default class ELK {
  layout() {
    return Promise.reject(
      new Error(
        "Nether does not include the ELK layout. Remove `layout: elk` to draw this diagram.",
      ),
    );
  }

  knownLayoutAlgorithms() {
    return Promise.resolve([]);
  }

  knownLayoutOptions() {
    return Promise.resolve([]);
  }

  knownLayoutCategories() {
    return Promise.resolve([]);
  }

  /** There is no worker to stop. */
  terminateWorker() {
    return undefined;
  }
}
