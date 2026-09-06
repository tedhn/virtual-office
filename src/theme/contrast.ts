/**
 * The colour maths behind the palette's one hard rule: text has to be readable.
 *
 * Every colour in `index.css` is written in oklch, which is a good space to *choose* a
 * palette in — even lightness steps look like even lightness steps — and no use at all for
 * *checking* one, because WCAG's contrast ratio is defined over sRGB luminance and oklch's
 * L is not that. `oklch(0.55 0 0)` and `oklch(0.55 0.15 250)` share a lightness and do not
 * share a luminance. So the tokens are converted the whole way down to what a screen shows
 * before anything is asserted about them.
 *
 * Only ever read at author time, by `palette.test.ts` — the browser resolves these tokens
 * itself and nothing here ships in a bundle.
 */

/** An oklch colour as the stylesheet writes it: lightness 0..1, chroma, hue in degrees. */
export interface Oklch {
  l: number
  c: number
  h: number
  alpha: number
}

/** A colour a screen can show, each channel 0..1 and gamma-encoded, as sRGB is. */
export interface Srgb {
  r: number
  g: number
  b: number
}

const OKLCH = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/

const ratio = (raw: string) => (raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw))

/**
 * Read one `oklch(...)` value, or null for anything else.
 *
 * Null rather than a guess: a token holding a hex, a `var()` or a keyword is a token this
 * cannot judge, and a checker that quietly scores an unparseable colour as passing is
 * worse than one that admits it does not know.
 */
export function parseColor(value: string): Oklch | null {
  const match = OKLCH.exec(value.trim())
  if (!match) return null
  return {
    l: ratio(match[1]),
    c: Number(match[2]),
    h: Number(match[3]),
    alpha: match[4] === undefined ? 1 : ratio(match[4]),
  }
}

const cube = (x: number) => x * x * x

/** Linear-light channel to the gamma-encoded one sRGB actually stores. */
const encode = (channel: number) =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055

/** And back, which is what a luminance is computed over. */
const decode = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/**
 * oklch to sRGB, by way of OKLab and linear light.
 *
 * Clamped at the end, and deliberately after encoding: a hue at a chroma no display can
 * reach comes back as the nearest thing it can, which is what the screen would have shown
 * anyway. Without the clamp an out-of-gamut token would score a luminance no pixel can
 * emit, and the contrast check would pass on a colour nobody can see.
 */
export function oklchToSrgb({ l: L, c, h }: Oklch): Srgb {
  const rad = (h * Math.PI) / 180
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)

  const long = cube(L + 0.3963377774 * a + 0.2158037573 * b)
  const medium = cube(L - 0.1055613458 * a - 0.0638541728 * b)
  const short = cube(L - 0.0894841775 * a - 1.291485548 * b)

  return {
    r: clamp01(encode(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short)),
    g: clamp01(encode(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short)),
    b: clamp01(encode(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short)),
  }
}

/**
 * A translucent colour resolved against what sits behind it.
 *
 * Needed because several tokens are alphas — a border at 10% white, a HUD panel at 60%
 * black — and the contrast a reader gets from one of those is the contrast of the blend,
 * not of the colour as written. Composited in gamma-encoded sRGB, which is what a browser
 * does when it paints one over the other.
 */
export function over(front: Oklch, behind: Srgb): Srgb {
  if (front.alpha >= 1) return oklchToSrgb(front)
  const top = oklchToSrgb(front)
  const mix = (a: number, b: number) => a * front.alpha + b * (1 - front.alpha)
  return { r: mix(top.r, behind.r), g: mix(top.g, behind.g), b: mix(top.b, behind.b) }
}


/** WCAG relative luminance of a colour, taken as opaque. */
function relativeLuminance(color: Oklch | Srgb): number {
  const { r, g, b } = "l" in color ? oklchToSrgb(color) : color
  return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b)
}

/**
 * WCAG contrast ratio, 1 to 21. Symmetric — neither colour is the foreground, which is why
 * a caller passes whichever two it has and compares the answer to a threshold.
 */
export function contrastRatio(a: Oklch | Srgb, b: Oklch | Srgb): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}
