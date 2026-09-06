/**
 * Reading the palette out of the stylesheet it is written in.
 *
 * There is no way to ask a running browser what `--primary` is from a Node test, and no
 * DOM here to ask — so the palette is checked at its source. That is also the honest place
 * for it: the assertion is about what the file declares, so a token passes because
 * somebody chose a colour rather than because a renderer happened to resolve one.
 */

/**
 * Every custom property declared in one selector's block — `:root`, `.dark`, or any other.
 *
 * Deliberately not a CSS parser. It finds the block by its selector and reads the
 * `--name: value;` lines out of it, which is all these blocks contain and all any caller
 * asks about. A nested block inside the one being read would confuse it; none exist, and
 * one appearing is a change worth noticing rather than silently absorbing.
 */
export function readTokenBlock(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`No \`${selector}\` block in the stylesheet`)

  const open = css.indexOf("{", start)
  const close = css.indexOf("}", open)
  if (close === -1) throw new Error(`Unclosed \`${selector}\` block in the stylesheet`)

  const tokens: Record<string, string> = {}
  for (const [, name, value] of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.trim()
  }
  return tokens
}
