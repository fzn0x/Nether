// Math, code and diagrams drawn for an exported page.
import { describe, expect, it } from "vitest";
import { highlightCode, mathToMathml } from "../src/render.ts";

describe("highlightCode", () => {
  it("highlights code in a language the editor knows, as spans with highlight.js's classes", () => {
    expect(highlightCode("let a = 1;", 'js title="a.js"')).toBe(
      '<span class="hljs-keyword">let</span> a = <span class="hljs-number">1</span>;',
    );
  });

  it("writes other code as its text, escaped", () => {
    expect(highlightCode("a < b && c", "")).toBe("a &lt; b &amp;&amp; c");
    expect(highlightCode("graph LR\n  a --> b", "mermaid")).toBe("graph LR\n  a --&gt; b");
  });
});

describe("mathToMathml", () => {
  it("writes LaTeX as MathML, inline or as a block", async () => {
    const inline = await mathToMathml("x^2", false);
    expect(inline).toMatch(
      /^<span class="katex"><math xmlns="http:\/\/www.w3.org\/1998\/Math\/MathML">/,
    );
    expect(inline).toContain("<msup><mi>x</mi><mn>2</mn></msup>");
    expect(await mathToMathml("x", true)).toContain('display="block"');
  });

  it("shows LaTeX it cannot read as text, without throwing", async () => {
    expect(await mathToMathml("\frac{1}{", false)).toContain("\frac{1}{");
  });
});
