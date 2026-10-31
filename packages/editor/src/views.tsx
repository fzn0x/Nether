// How rich blocks look and edit in a page: math rendered with KaTeX and
// edited as LaTeX, code with its language, and Mermaid diagrams drawn below
// their code. Each view changes only the attributes the schema has. KaTeX
// and Mermaid load with the first note that needs them.
import {
  type NodeViewProps,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type { KatexOptions } from "katex";
import {
  type ChangeEvent,
  type ComponentType,
  type KeyboardEvent,
  useEffect,
  useId,
  useState,
} from "react";
import { EmbedView, FileView, ImageView, backToNote } from "./embeds.tsx";
import type { NoteFiles } from "./files.ts";
import type { NoteLinks } from "./LinkMenu.tsx";
import { BookmarkView, type LinkPreviews } from "./previews.tsx";
import { type NodeViews, codeLanguage } from "./schema.ts";
import { type EditorWords, englishWords } from "./words.ts";

interface ViewProps extends NodeViewProps {
  readonly words: EditorWords;
}

type RenderMath = (latex: string, options: KatexOptions) => string;

let renderMath: RenderMath | undefined;
let loadingMath: Promise<RenderMath> | undefined;

/** KaTeX's renderer, once it has loaded. */
function useRenderMath(): RenderMath | undefined {
  const [render, setRender] = useState(() => renderMath);
  useEffect(() => {
    if (render !== undefined) return;
    let current = true;
    loadingMath ??= import("katex").then(({ default: katex }) => {
      renderMath = (latex, options) => katex.renderToString(latex, options);
      return renderMath;
    });
    void loadingMath.then((loaded) => {
      if (current) setRender(() => loaded);
    });
    return () => {
      current = false;
    };
  }, [render]);
  return render;
}

/** Ends editing; back in the note with the math selected, unless focus left for elsewhere. */
function finish(props: ViewProps, refocus: boolean, close: () => void) {
  close();
  if (refocus) backToNote(props);
}

function MathSource(props: {
  readonly value: string;
  readonly multiline: boolean;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly onDone: (refocus: boolean) => void;
}) {
  const { value, multiline, label, onChange, onDone } = props;
  const change = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(event.target.value);
  };
  const key = (event: KeyboardEvent) => {
    const enter = event.key === "Enter" && (!multiline || event.ctrlKey || event.metaKey);
    if (event.key === "Escape" || enter) {
      event.preventDefault();
      onDone(true);
    }
  };
  const blur = () => {
    onDone(false);
  };
  // The field opens because the user asked to edit the math, so it takes focus.
  return multiline ? (
    <textarea
      className="math-source"
      aria-label={label}
      value={value}
      rows={Math.max(2, value.split("\n").length)}
      autoFocus
      spellCheck={false}
      onChange={change}
      onKeyDown={key}
      onBlur={blur}
    />
  ) : (
    <input
      className="math-source"
      aria-label={label}
      value={value}
      autoFocus
      spellCheck={false}
      onChange={change}
      onKeyDown={key}
      onBlur={blur}
    />
  );
}

function MathView(props: ViewProps & { readonly display: boolean }) {
  const { display, words, editor, node } = props;
  const latex = typeof node.attrs.latex === "string" ? node.attrs.latex : "";
  // New math opens for typing; math already in a note shows rendered.
  const [editing, setEditing] = useState(latex === "");
  const render = useRenderMath();
  // KaTeX builds this markup itself; with trust off, \href, \url and
  // \htmlClass cannot add links, classes or scripts.
  const html = render?.(latex === "" ? "\\square" : latex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
  });
  return (
    <NodeViewWrapper
      // A block's wrapper is a div already; TipTap writes `as` out as an attribute.
      {...(display ? {} : { as: "span" })}
      className={display ? "math-block" : "math-inline"}
      data-selected={props.selected ? "" : undefined}
    >
      {editing && editor.isEditable ? (
        <MathSource
          value={latex}
          multiline={display}
          label={words.editMath}
          onChange={(value) => {
            props.updateAttributes({ latex: value });
          }}
          onDone={(refocus) => {
            finish(props, refocus, () => {
              setEditing(false);
            });
          }}
        />
      ) : (
        // Enter on selected math clicks this (see the schema's math nodes);
        // it stays out of the tab order, which belongs to the note. Its name
        // is the math, read from KaTeX's MathML, so that it says what shows.
        <button
          type="button"
          tabIndex={-1}
          className="math-render"
          title={words.showMath}
          onClick={() => {
            if (editor.isEditable) setEditing(true);
          }}
        >
          {html === undefined ? (
            // The LaTeX itself while KaTeX loads.
            <code>{latex}</code>
          ) : (
            // KaTeX's own markup.
            <span dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </button>
      )}
    </NodeViewWrapper>
  );
}

function MathBlockView(props: ViewProps) {
  return <MathView {...props} display />;
}

function MathInlineView(props: ViewProps) {
  return <MathView {...props} display={false} />;
}

/** A Mermaid diagram drawn from a code block's text. Mermaid loads with the first diagram. */
function MermaidPreview(props: { readonly source: string; readonly errorLabel: string }) {
  const { source, errorLabel } = props;
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let current = true;
    // Draw once typing pauses, not on every key.
    const timer = setTimeout(() => {
      void import("mermaid")
        .then(async ({ default: mermaid }) => {
          mermaid.initialize({
            startOnLoad: false,
            // Diagrams cannot run scripts, follow clicks or load content.
            securityLevel: "strict",
            suppressErrorRendering: true,
            // Mermaid's default is the ELK layout, which Nether does not
            // include (ADR 0009); dagre lays out the same diagrams.
            layout: "dagre",
            theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default",
          });
          await mermaid.parse(source);
          const result = await mermaid.render(id, source);
          if (!current) return;
          setSvg(result.svg);
          setError(undefined);
        })
        .catch((reason: unknown) => {
          document.getElementById(`d${id}`)?.remove();
          if (current) setError(reason instanceof Error ? reason.message : String(reason));
        });
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [source, id]);

  if (error !== undefined) {
    return (
      <div className="diagram-error" contentEditable={false} role="status">
        <p>{errorLabel}</p>
        <pre>{error}</pre>
      </div>
    );
  }
  return svg === undefined ? null : (
    <div
      className="diagram"
      contentEditable={false}
      // Mermaid's SVG, drawn with securityLevel "strict", which sanitizes it.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function CodeBlockView(props: ViewProps & { readonly links: NoteLinks | undefined }) {
  const { node, words, editor, links } = props;
  const language = typeof node.attrs.language === "string" ? node.attrs.language : "";
  const name = codeLanguage(language);
  const isDiagram = name.toLowerCase() === "mermaid";
  const isQuery = name.toLowerCase() === "base";
  return (
    <NodeViewWrapper className="code-block">
      <div className="code-tools" contentEditable={false}>
        <input
          className="code-language"
          aria-label={words.codeLanguage}
          placeholder={words.codeLanguage}
          value={language}
          readOnly={!editor.isEditable}
          spellCheck={false}
          onChange={(event) => {
            // The fence's whole info string, such as `ts title="a.ts"`.
            const value = event.target.value;
            props.updateAttributes({ language: value.trim() === "" ? null : value });
          }}
        />
      </div>
      <pre>
        <NodeViewContent<"code">
          as="code"
          className={name === "" ? undefined : `language-${name}`}
        />
      </pre>
      {isDiagram ? (
        <MermaidPreview source={node.textContent} errorLabel={words.diagramError} />
      ) : null}
      {isQuery && links?.renderQuery !== undefined ? (
        // The notes a query finds are the app's to show; the editor gives it the code.
        <div className="code-query" contentEditable={false}>
          {links.renderQuery(node.textContent)}
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

/**
 * The node views of rich blocks, for an editor in a page, in the app's
 * words; `files` finds the files a note links to, and `links` the notes it
 * embeds, `depth` embeds deep.
 */
export function netherNodeViews(
  words: EditorWords = englishWords,
  files?: NoteFiles,
  links?: NoteLinks,
  depth = 0,
  previews?: LinkPreviews,
): NodeViews {
  const view = (
    View: ComponentType<
      ViewProps & {
        readonly files: NoteFiles | undefined;
        readonly links: NoteLinks | undefined;
        readonly depth: number;
      }
    >,
  ) =>
    ReactNodeViewRenderer(function WordedView(props: NodeViewProps) {
      return <View {...props} words={words} files={files} links={links} depth={depth} />;
    });
  return {
    mathBlock: view(MathBlockView),
    mathInline: view(MathInlineView),
    codeBlock: view(CodeBlockView),
    image: view(ImageView),
    file: view(FileView),
    embed: view(EmbedView),
    bookmark: ReactNodeViewRenderer(function PreviewedBookmark(props: NodeViewProps) {
      return <BookmarkView {...props} words={words} previews={previews} />;
    }),
  };
}
