// @vitest-environment jsdom
// Others editing a note at once (ADR 0043): two editors on two copies of a
// note's document, their updates and awareness passed between them as a
// server would, each showing the other's caret with their name.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { NoteEditor } from "../src/NoteEditor.tsx";

// React's act, outside a test renderer, asks to be told it runs in one.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Two copies of one document, and their awareness, kept in step as a server keeps them. */
function pair() {
  const ada = new Y.Doc();
  const bea = new Y.Doc();
  ada.on("update", (update: Uint8Array) => {
    Y.applyUpdate(bea, update, "server");
  });
  bea.on("update", (update: Uint8Array) => {
    Y.applyUpdate(ada, update, "server");
  });
  const adas = new Awareness(ada);
  const beas = new Awareness(bea);
  const pass = (from: Awareness, to: Awareness) => {
    from.on("update", ({ added, updated, removed }: Record<string, number[]>) => {
      const changed = [...(added ?? []), ...(updated ?? []), ...(removed ?? [])];
      applyAwarenessUpdate(to, encodeAwarenessUpdate(from, changed), "server");
    });
  };
  pass(adas, beas);
  pass(beas, adas);
  return { ada, bea, adas, beas };
}

function mount(document: Y.Doc, awareness: Awareness, name: string, color: string) {
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <NoteEditor
        document={document}
        label={`${name}'s editor`}
        collaboration={{ awareness, user: { name, color } }}
      />,
    );
  });
  cleanups.push(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });
  return container;
}

describe("editing with others", () => {
  it("shows another's caret with their name and color, and tells them who this is", async () => {
    const { ada, bea, adas, beas } = pair();
    const adasView = mount(ada, adas, "Ada", "#1d5c94");
    // Ada's editor tells the others who she is.
    const user = (state: unknown) => (state as { user?: { name?: string } } | undefined)?.user;
    expect(user(beas.getStates().get(adas.clientID))?.name).toBe("Ada");

    // Bea, elsewhere, has her caret at the start of the note.
    const start: unknown = Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(bea.getXmlFragment("content"), 0),
    );
    await act(async () => {
      beas.setLocalState({
        user: { name: "Bea", color: "#2f6b1f" },
        cursor: { anchor: start, head: start },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const label = adasView.querySelector<HTMLElement>(".collaboration-carets__label");
    expect(label?.textContent).toBe("Bea");
    expect(label?.style.backgroundColor).toBe("rgb(47, 107, 31)");

    // Gone, her caret goes.
    await act(async () => {
      beas.setLocalState(null);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(adasView.querySelector(".collaboration-carets__label")).toBeNull();
  });
});
