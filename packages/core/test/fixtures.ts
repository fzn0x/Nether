// Notes as plain JSON, the way they arrive from a file or another process.

export const ids = {
  note: "01929f4c-7b00-7a00-8000-000000000001",
  other: "01929f4c-7b00-7a00-8000-000000000002",
  database: "01929f4c-7b00-7a00-8000-000000000003",
  view: "01929f4c-7b00-7a00-8000-000000000004",
  workspace: "01929f4c-7b00-7a00-8000-000000000005",
  row: "01929f4c-7b00-7a00-8000-000000000006",
} as const;

const text = (value: string) => ({ type: "text", text: value });

/** A note that uses every built-in block type and every kind of inline content. */
export function richNote(): Record<string, unknown> {
  return {
    id: ids.note,
    title: "Weekly review",
    properties: [
      { key: "status", value: "In progress" },
      { key: "tags", value: ["review", "weekly"] },
      { key: "due", value: "2026-11-06" },
      { key: "related", value: [ids.other] },
      { key: "empty", value: null },
    ],
    content: [
      { id: "h1", type: "heading", attrs: { level: 1 }, content: [text("Weekly review")] },
      {
        id: "p1",
        type: "paragraph",
        content: [
          text("Plain, "),
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          {
            type: "text",
            text: " and a link",
            marks: [
              { type: "link", href: "https://example.com", title: "Example" },
              { type: "italic" },
            ],
          },
          { type: "hardBreak" },
          { type: "wikiLink", target: { note: ids.other, heading: "Phase 1" }, alias: "the plan" },
          { type: "wikiLink", target: { title: "Not written yet" } },
          { type: "wikiLink", target: { heading: "Next week" }, marks: [{ type: "bold" }] },
          { type: "wikiLink", target: { block: "b2" } },
          { type: "tag", name: "area/research", marks: [{ type: "italic" }] },
          { type: "math", latex: "e^{i\\pi} + 1 = 0" },
          { type: "raw", markdown: "<kbd>Ctrl</kbd>" },
          { type: "math", latex: "a +\nb" },
          { type: "raw", markdown: "<span\nclass=x>" },
        ],
      },
      {
        id: "b1",
        type: "bulletListItem",
        content: [text("First point")],
        children: [
          {
            id: "b2",
            type: "bulletListItem",
            content: [{ type: "wikiLink", target: { note: ids.other, block: "req-sync" } }],
          },
        ],
      },
      { id: "n1", type: "numberedListItem", attrs: { start: 5 }, content: [text("Fifth")] },
      { id: "n2", type: "numberedListItem", content: [text("Sixth")] },
      {
        id: "t1",
        type: "taskListItem",
        attrs: { checked: true },
        content: [text("Run the spike")],
      },
      {
        id: "q1",
        type: "quote",
        children: [{ id: "q2", type: "paragraph", content: [text("Quoted")] }],
      },
      {
        id: "c1",
        type: "callout",
        attrs: { kind: "note", fold: "open" },
        content: [{ type: "wikiLink", target: { title: "Decisions" } }],
        children: [{ id: "c2", type: "paragraph", content: [text("Notes stay files.")] }],
      },
      { id: "g1", type: "toggle", content: [text("Details")] },
      { id: "code1", type: "code", attrs: { language: "ts" }, text: "const a = 1;\n" },
      { id: "m1", type: "math", text: "\\sum_{n=1}^{\\infty} \\frac{1}{n^2}" },
      { id: "d1", type: "divider" },
      {
        id: "tb1",
        type: "table",
        attrs: { header: true, align: ["left", null] },
        children: [
          {
            id: "r1",
            type: "tableRow",
            children: [
              { id: "cell-1", type: "tableCell", content: [text("Feature")] },
              { id: "cell-2", type: "tableCell", content: [] },
            ],
          },
          {
            id: "r2",
            type: "tableRow",
            children: [
              {
                id: "cell-3",
                type: "tableCell",
                content: [{ type: "wikiLink", target: { title: "Editor" } }],
              },
              { id: "cell-4", type: "tableCell", content: [text("1")] },
            ],
          },
        ],
      },
      {
        id: "cols",
        type: "columns",
        children: [
          {
            id: "col1",
            type: "column",
            attrs: { width: 0.5 },
            children: [{ id: "col1p", type: "paragraph", content: [text("Left")] }],
          },
          { id: "col2", type: "column", children: [] },
        ],
      },
      {
        id: "img",
        type: "image",
        attrs: { src: "attachments/diagram.png", alt: "Diagram", title: "Sync", width: 640 },
      },
      { id: "f1", type: "file", attrs: { src: "attachments/spec.pdf", name: "Spec" } },
      { id: "bm", type: "bookmark", attrs: { url: "https://example.com/post" } },
      { id: "e1", type: "embed", attrs: { target: { note: ids.other } } },
      { id: "e2", type: "embed", attrs: { target: { title: "diagram.png" }, alias: "300" } },
      { id: "db", type: "database", attrs: { database: ids.database, view: ids.view } },
      { id: "raw1", type: "raw", text: "<details>\n</details>\n" },
      {
        id: "plug",
        type: "kanban-plugin/board",
        attrs: { lanes: 3, labels: { done: "Done" } },
        content: [text("Board")],
        children: [{ id: "plug-p", type: "paragraph", content: [] }],
      },
    ],
    parent: ids.other,
    created: "2026-10-30T08:00:00.000Z",
    updated: "2026-10-30T09:15:30.250Z",
  };
}

/** A database note: a schema with one view of each layout. */
export function databaseNote(): Record<string, unknown> {
  return {
    id: ids.database,
    title: "Projects",
    properties: [],
    content: [],
    database: {
      properties: [
        {
          key: "status",
          type: "select",
          options: [
            { name: "Planned", color: "gray" },
            { name: "Done", color: "green" },
          ],
        },
        { key: "labels", type: "multiSelect" },
        { key: "due", type: "date" },
        { key: "ends", type: "date" },
        { key: "estimate", type: "number" },
        { key: "done", type: "checkbox" },
        { key: "site", type: "url" },
        { key: "owner", type: "person" },
        {
          key: "blocks",
          type: "relation",
          relation: { database: ids.database, backlink: "blocked by" },
        },
        { key: "blocked by", type: "relation", relation: { database: ids.database } },
        { key: "cover", type: "file" },
        { key: "summary", type: "text" },
      ],
      views: [
        {
          id: ids.view,
          name: "All",
          layout: "table",
          visible: ["$title", "status", "due"],
          sorts: [{ property: "due", direction: "ascending" }],
          filter: {
            and: [
              { property: "status", operator: "notEquals", value: "Done" },
              {
                or: [
                  { property: "due", operator: "isEmpty" },
                  { property: "due", operator: "after", value: "2026-01-01" },
                ],
              },
            ],
          },
          groupBy: "owner",
        },
        {
          id: "01929f4c-7b00-7a00-8000-000000000011",
          name: "Board",
          layout: "board",
          visible: [],
          groupBy: "status",
        },
        {
          id: "01929f4c-7b00-7a00-8000-000000000012",
          name: "Calendar",
          layout: "calendar",
          visible: [],
          date: "due",
        },
        {
          id: "01929f4c-7b00-7a00-8000-000000000013",
          name: "Timeline",
          layout: "timeline",
          visible: ["$title"],
          date: "$created",
          end: "ends",
        },
        {
          id: "01929f4c-7b00-7a00-8000-000000000014",
          name: "Gallery",
          layout: "gallery",
          visible: [],
          cover: "cover",
        },
        {
          id: "01929f4c-7b00-7a00-8000-000000000015",
          name: "List",
          layout: "list",
          visible: ["summary"],
        },
      ],
    },
    created: "2026-10-30T08:00:00.000Z",
    updated: "2026-10-30T08:00:00.000Z",
  };
}

/** The item at `index`, which the test knows is there. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${String(index)}`);
  return item;
}

/** A copy of a JSON value with `change` applied, for one-off broken inputs. */
export function edit<T>(value: T, change: (copy: T) => void): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  change(copy);
  return copy;
}
