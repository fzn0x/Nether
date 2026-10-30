// The list of a vault's notes. It draws only the rows in view, so a vault of
// 50,000 notes scrolls as smoothly as one of fifty, and moves between notes
// with the arrow keys.
import type { NoteId } from "@nether/core";
import { type NoteEntry, folderOf } from "@nether/storage";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

const rowHeight = 30;
const overscan = 8;

export function NoteList(props: {
  readonly notes: readonly NoteEntry[];
  readonly selected: NoteId | undefined;
  readonly onSelect: (id: NoteId) => void;
  readonly label: string;
}) {
  const { notes, selected, onSelect, label } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const measure = () => {
      setView({ top: element.scrollTop, height: element.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, []);

  const first = Math.max(0, Math.floor(view.top / rowHeight) - overscan);
  const last = Math.min(notes.length, Math.ceil((view.top + view.height) / rowHeight) + overscan);
  const index = notes.findIndex((note) => note.id === selected);

  const select = (next: number) => {
    const note = notes[Math.max(0, Math.min(notes.length - 1, next))];
    if (note === undefined) return;
    onSelect(note.id);
    const element = scroller.current;
    const at = notes.indexOf(note) * rowHeight;
    if (element !== null) {
      if (at < element.scrollTop) element.scrollTop = at;
      else if (at + rowHeight > element.scrollTop + element.clientHeight) {
        element.scrollTop = at + rowHeight - element.clientHeight;
      }
    }
    // Focus follows the selection once the row is drawn.
    requestAnimationFrame(() => {
      scroller.current?.querySelector<HTMLElement>(`[data-id="${note.id}"]`)?.focus();
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const page = Math.max(1, Math.floor(view.height / rowHeight) - 1);
    const moves: Partial<Record<string, number>> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      PageDown: index + page,
      PageUp: index - page,
      Home: 0,
      End: notes.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  };

  return (
    <div className="note-list" ref={scroller} onKeyDown={onKeyDown}>
      <ul aria-label={label} style={{ height: notes.length * rowHeight }}>
        {notes.slice(first, last).map((note, offset) => {
          const position = first + offset;
          const folder = folderOf(note.path);
          return (
            <li
              key={note.id}
              style={{ top: position * rowHeight, height: rowHeight }}
              aria-setsize={notes.length}
              aria-posinset={position + 1}
            >
              <button
                type="button"
                data-id={note.id}
                aria-current={note.id === selected ? "page" : undefined}
                // One row is in the tab order: the selected one, or the first.
                tabIndex={note.id === selected || (index === -1 && position === 0) ? 0 : -1}
                onClick={() => {
                  onSelect(note.id);
                }}
                title={note.path}
              >
                <span className="note-title">{note.title}</span>
                {folder === "" ? null : <span className="note-folder">{folder}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
