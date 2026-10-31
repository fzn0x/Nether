// Where a note's database shows, below its text: the database view, and the
// code it brings, load only for a note whose frontmatter has a database, as
// few notes do, so the rest open without it.
import { databaseKey } from "@nether/database";
import { documentProperties } from "@nether/editor";
import type { PropertyEntry } from "@nether/core";
import { Suspense, lazy, useEffect, useState } from "react";
import type * as Y from "yjs";
import type { DatabaseProps } from "./DatabaseView.tsx";

const DatabaseView = lazy(() =>
  import("./DatabaseView.tsx").then(({ DatabaseView: view }) => ({ default: view })),
);

/** The note's properties, kept current as its document changes. */
export function useDocumentProperties(document: Y.Doc): readonly PropertyEntry[] {
  const [entries, setEntries] = useState(() => documentProperties(document));
  useEffect(() => {
    const refresh = () => {
      setEntries(documentProperties(document));
    };
    refresh();
    document.on("update", refresh);
    return () => {
      document.off("update", refresh);
    };
  }, [document]);
  return entries;
}

export function DatabaseSlot(props: DatabaseProps) {
  const entries = useDocumentProperties(props.document);
  if (!entries.some((entry) => entry.key === databaseKey)) return null;
  return (
    <Suspense fallback={null}>
      <DatabaseView {...props} />
    </Suspense>
  );
}
