// How exported notes look: a readable column of text, with callouts, task
// lists, tables, code and properties styled as the app styles them. HTML
// pages follow the reader's light or dark preference; a PDF is printed
// light, each note starting a new page, from a view kept apart from the
// app's own styles.

/** The rules both kinds share, each selector after `scope`. */
function rules(scope: string): string {
  const s = scope === "" ? "" : `${scope} `;
  return `
${s}article { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
${s}article :is(h1, h2, h3, h4, h5, h6) { margin: 1.6em 0 0.5em; line-height: 1.25; }
${s}article h1 { font-size: 2rem; }
${s}article h2 { font-size: 1.5rem; }
${s}article h3 { font-size: 1.25rem; }
${s}article > :first-child { margin-top: 0; }
${s}article p, ${s}article ul, ${s}article ol, ${s}article table, ${s}article pre { margin: 0 0 1em; }
${s}article a { color: var(--accent); }
${s}article .internal-link.unresolved { color: var(--muted); }
${s}article .tag { color: var(--accent); }
${s}article mark { background: #f5d54780; color: inherit; border-radius: 2px; }
${s}article code { padding: 0.1em 0.3em; border-radius: 4px; background: var(--code-bg); font: 0.9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
${s}article pre { padding: 0.8em 1em; overflow-x: auto; border-radius: 6px; background: var(--code-bg); }
${s}article pre code { padding: 0; background: none; }
${s}article blockquote { margin: 0 0 1em; padding-left: 1em; border-left: 3px solid var(--rule); color: var(--muted); }
${s}article hr { border: 0; border-top: 1px solid var(--rule); margin: 2em 0; }
${s}article table { border-collapse: collapse; }
${s}article th, ${s}article td { padding: 0.35em 0.7em; border: 1px solid var(--rule); }
${s}article th { background: var(--code-bg); }
${s}article img, ${s}article video, ${s}article svg { max-width: 100%; height: auto; }
${s}article .tasks { padding-left: 0.5em; list-style: none; }
${s}article .task input { margin: 0 0.4em 0 0; }
${s}article .callout { margin: 0 0 1em; padding: 0.6em 1em; border: 1px solid var(--callout-rule); border-radius: 6px; background: var(--callout-bg); }
${s}article .callout-title { margin: 0 0 0.4em; font-weight: 600; }
${s}article details > summary { cursor: pointer; }
${s}article .properties { display: grid; grid-template-columns: max-content 1fr; gap: 0.2em 1em; margin: 0 0 1.5em; color: var(--muted); font-size: 0.9em; }
${s}article .properties dt { font-weight: 600; }
${s}article .properties dd { margin: 0; }
${s}article .embed { margin: 0 0 1em; padding: 0.2em 1em; border-left: 3px solid var(--rule); }
${s}article .columns { display: flex; gap: 1.5em; }
${s}article .column { flex: 1; min-width: 0; }
${s}article .diagram { margin: 0 0 1em; text-align: center; }
${s}article .file.missing, ${s}article .raw { color: var(--muted); }
${s}article .hljs-keyword, ${s}article .hljs-selector-tag, ${s}article .hljs-built_in { color: var(--code-keyword); }
${s}article .hljs-string, ${s}article .hljs-attr, ${s}article .hljs-regexp { color: var(--code-string); }
${s}article .hljs-number, ${s}article .hljs-literal { color: var(--code-number); }
${s}article .hljs-title, ${s}article .hljs-function { color: var(--code-title); }
${s}article .hljs-type, ${s}article .hljs-class { color: var(--code-type); }
${s}article .hljs-comment, ${s}article .hljs-quote { color: var(--muted); font-style: italic; }
`;
}

const light = `
  --text: #1b1822; --muted: #5f5a66; --accent: #c43d18; --rule: #e3ddd3;
  --bg: #fffdf9; --code-bg: #f1ede6; --callout-bg: #c43d1812; --callout-rule: #c43d1847;
  --code-keyword: #86288c; --code-string: #2f6b1f; --code-number: #9a4600;
  --code-title: #1d5c94; --code-type: #735000;`;

const dark = `
  --text: #ece8e1; --muted: #a39da8; --accent: #ff7a50; --rule: #2a2631;
  --bg: #131118; --code-bg: #1e1b24; --callout-bg: #ff7a501a; --callout-rule: #ff7a5047;
  --code-keyword: #dda3f2; --code-string: #a8da8d; --code-number: #f4ae74;
  --code-title: #92c6ff; --code-type: #e8c47e;`;

const font = `font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;`;

/** The style of an exported HTML page, light or dark as its reader prefers. */
export const pageStyle = `
:root { color-scheme: light dark;${light} }
@media (prefers-color-scheme: dark) { :root {${dark} } }
body { margin: 0; background: var(--bg); color: var(--text); ${font} }
nav.index ul { padding-left: 1.2em; }
${rules("")}`;

/**
 * The style of the print view a PDF is made from: shown only in print, the
 * app hidden, light, and each note on a new page.
 */
export const printStyle = `
#print-root { display: none; }
@media print {
  html, body { background: #fff !important; }
  body > :not(#print-root) { display: none !important; }
  #print-root { display: block;${light} color: var(--text); ${font} }
  #print-root article { max-width: none; padding: 0; }
  #print-root article + article { break-before: page; }
  #print-root :is(pre, table, figure, img, .callout) { break-inside: avoid; }
}
${rules("#print-root")}`;
