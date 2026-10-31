// What is assigned to me (task assignment): in the sidebar, the rows of
// every database, and the notes outside them, whose person properties name
// the name this device goes by, by database, the soonest first, each with
// how it stands. Read from the link index, so it follows as notes change.
import type { NoteId } from "@nether/core";
import type { LinkGraph } from "@nether/graph";
import type { NoteEntry, Vault } from "@nether/storage";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { t } from "./messages.ts";
import { assignedTo, myName, subscribeMyName } from "./people.ts";
import { type PropertyTypes, readPropertyTypes } from "./properties.ts";
import { useGraph } from "./useGraph.ts";

export function AssignedPanel(props: {
  readonly vault: Vault;
  readonly graph: LinkGraph;
  readonly notes: readonly NoteEntry[];
  readonly onOpen: (id: NoteId) => void;
  /** Asks for the name this device goes by. */
  readonly onSetName: () => void;
}) {
  const { vault, graph, notes, onOpen, onSetName } = props;
  const me = useSyncExternalStore(subscribeMyName, myName);
  const version = useGraph(graph);
  const [types, setTypes] = useState<PropertyTypes>({});
  useEffect(() => {
    let current = true;
    void vault.readData("properties").then((data) => {
      if (current) setTypes(readPropertyTypes(data));
    });
    return () => {
      current = false;
    };
  }, [vault]);
  const groups = useMemo(
    () => assignedTo(me, notes, graph, types),
    [me, notes, graph, version, types],
  );

  if (me === "") {
    return (
      <div className="assigned-panel">
        <p className="placeholder">{t("assignedNoName")}</p>
        <button type="button" className="quiet" aria-haspopup="dialog" onClick={onSetName}>
          {t("command_myName")}
        </button>
      </div>
    );
  }

  return (
    <div className="assigned-panel">
      <p className="assigned-who">
        {t("assignedTo", { name: me })}
        <button type="button" className="quiet" aria-haspopup="dialog" onClick={onSetName}>
          {t("assignedChange")}
        </button>
      </p>
      {groups.length === 0 ? (
        <p className="placeholder">{t("assignedNone", { name: me })}</p>
      ) : (
        groups.map((group) => {
          const heading = group.database?.title ?? t("assignedOther");
          return (
            <section key={group.database?.id ?? ""} className="assigned-group" aria-label={heading}>
              <h3>
                {group.database === undefined ? (
                  heading
                ) : (
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => {
                      if (group.database !== undefined) onOpen(group.database.id);
                    }}
                  >
                    {heading}
                  </button>
                )}
              </h3>
              <ul>
                {group.notes.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onOpen(note.id);
                      }}
                    >
                      <span className="assigned-title">{note.title}</span>
                      {note.status === undefined && note.date === undefined ? null : (
                        <span className="assigned-meta">
                          {[note.status, note.date]
                            .filter((part) => part !== undefined)
                            .join(" · ")}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
