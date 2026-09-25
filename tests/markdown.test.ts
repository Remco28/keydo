import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/markdown.js";

describe("Markdown description preview", () => {
  test("renders supported emphasis, lists, headings, and links", () => {
    expect(renderMarkdown("# Heading\n\n**strong** and __also strong__\n* first\n- second\n[Todoist](https://todoist.com)"))
      .toBe('<h1>Heading</h1><p><strong>strong</strong> and <strong>also strong</strong></p><ul><li>first</li><li>second</li></ul><p><a href="https://todoist.com" target="_blank" rel="noopener noreferrer">Todoist</a></p>');
  });

  test("keeps emphasis around links without parsing marker characters in their URLs", () => {
    expect(renderMarkdown("**[bold link](https://example.com/**path**)**"))
      .toBe('<p><strong><a href="https://example.com/**path**" target="_blank" rel="noopener noreferrer">bold link</a></strong></p>');
  });

  test("escapes HTML and leaves unsafe links non-executable", () => {
    expect(renderMarkdown('<img src=x onerror="alert(1)"> [run](javascript:alert(1))'))
      .toBe('<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; [run](javascript:alert(1))</p>');
  });

  test("keeps image syntax as text instead of loading remote embedded content", () => {
    expect(renderMarkdown("![remote](https://example.com/image.png)"))
      .toBe("<p>![remote](https://example.com/image.png)</p>");
  });

  test("does not parse Markdown inside code spans", () => {
    expect(renderMarkdown("`[link](https://example.com)`"))
      .toBe("<p><code>[link](https://example.com)</code></p>");
  });
});
