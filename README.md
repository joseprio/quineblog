# Quine Blog

A whole blog in one HTML file. The page contains its own posts, styles, script and editor
([Pell](https://github.com/jaredreich/pell)), and can save a new copy of itself with your changes.

**[Live demo](https://joseprio.github.io/quineblog/dist/index.html)**

- **Compact.** The demo is a single ~73 KiB file (~26 KiB gzipped) with seven posts, the editor and
  syntax highlighting. It needs no server, database or external requests, and works as a static file on any host.
- **Search engine friendly.** Every post is prerendered as plain semantic HTML. Crawlers and readers
  without JavaScript get all the content. The script only shows and hides parts of the page. The page also
  carries description and Open Graph meta tags, plus JSON-LD (`Blog` / `BlogPosting`) structured data.

## Build

```sh
npm install
npm run build                                   # dist/index.html from content/seed.json
npm run build -- --data my-blog.json --out public/index.html
npm run build -- --langs markup,css,clike,javascript,python   # Prism grammars to include
```

The build type-checks the TypeScript in `src/`, bundles and minifies it and the CSS with
esbuild, and inlines both into `src/index.html` along with the Prism
grammars. Grammars are copied as Prism ships them (its prebuilt `.min.js` files) and are never run through
the minifiers; the only change is escaping `<!--` and `</script` so they can sit inside a `<script>` tag.
It then prerenders the posts by running the page's own `importData()` and
`exportHTML()` in jsdom. It fails if exporting the built page again doesn't reproduce it exactly.

## Writing

Open `dist/index.html` and use the **⋯** menu next to *Categories*: **New post**, **Edit this post**
(on a post page), **Settings** and **Download HTML**. While there are unsaved changes, a bar at the
bottom of the page offers the download too. Upload the downloaded file to publish.

- **✂** in the editor marks where the snippet on the home page ends.
- Images (button, paste or drop) are inlined as data URLs; large ones are downscaled first.
- **</>** makes a code block and asks for its language (`js`, `html`, `css`, …).
- Categories are a comma-separated field per post.
- **Settings** holds the blog title, description and theme hue.

## Code highlighting

Code blocks are stored as plain `<pre><code data-lang="js">`. At runtime [Prism](https://prismjs.com)
tokenises them and the [CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API)
paints the tokens with colours derived from `--hue`. Browsers without the API show plain code.

Grammars are stored in the page as `<script type="text/plain" data-prism-lang="…">` elements and
evaluated in dependency order. The default set is Prism's: markup (HTML, XML, SVG, MathML, SSML,
Atom, RSS), CSS, C-like and JavaScript. **Settings → Code languages** downloads more from jsDelivr
(with their prerequisites), adds a grammar file from disk, or removes one.

## Upgrading

**Settings → Export data** saves every post, setting and code language as JSON (`format: "quine-blog"`).
Open a newer build, **Settings → Import data**, then **Download HTML**. You can also build a new
version directly from an export with `npm run build -- --data your-export.json`.

## Source layout

| File | Purpose |
| --- | --- |
| `src/index.html` | Page shell; `{{STYLE}}`, `{{SCRIPT}}` and `{{GENERATOR}}` are filled by the build |
| `src/styles.css` | Class-less theme; every colour derives from `--hue`, with `light-dark()` for dark mode |
| `src/content.ts` | Posts as DOM, sanitising, derived markup (TOC, categories, JSON-LD), import/export |
| `src/code.ts` | Prism grammar storage (add/remove/CDN) and highlighting |
| `src/views.ts` | Hash router, infinite scroll, TOC highlighting |
| `src/editor.ts` | Post editor dialog (Pell), image inlining, read-more marker |
| `src/pell.ts` | Rich-text editor: an adapted TypeScript copy of [Pell](https://github.com/jaredreich/pell) 1.0.6 (MIT) |
| `src/settings.ts` | Settings dialog and JSON import/export |
| `src/author.ts` | The **⋯** menu, the unsaved-changes bar and **Download HTML** |
| `content/seed.json` | Sample posts used by the default build |
