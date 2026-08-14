export type TuiColorMode = "truecolor" | "ansi256" | "ansi16" | "none";
export type TuiThemeName = "dark" | "light";
export type TuiTone = "normal" | "primary" | "accent" | "success" | "warning" | "error" | "info";

export interface TuiCapabilities {
  colorMode: TuiColorMode;
  theme: TuiThemeName;
}

type Rgb = readonly [number, number, number];

const PALETTE: Record<TuiThemeName, Record<TuiTone, Rgb>> = {
  dark: {
    normal: [238, 238, 238],
    primary: [250, 178, 131],
    accent: [157, 124, 216],
    success: [127, 216, 143],
    warning: [245, 167, 66],
    error: [224, 108, 117],
    info: [86, 182, 194]
  },
  light: {
    normal: [26, 26, 26],
    primary: [59, 125, 216],
    accent: [214, 140, 39],
    success: [61, 154, 87],
    warning: [214, 140, 39],
    error: [209, 56, 61],
    info: [49, 135, 149]
  }
};

const ANSI16: readonly Rgb[] = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0],
  [0, 0, 238], [205, 0, 205], [0, 205, 205], [128, 128, 128],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]
];

function distance(a: Rgb, b: Rgb): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function ansi256Index(rgb: Rgb): number {
  if (rgb[0] === rgb[1] && rgb[1] === rgb[2]) return 232 + Math.max(0, Math.min(23, Math.round((rgb[0] - 8) / 10)));
  const quantize = (value: number) => Math.max(0, Math.min(5, Math.round(value / 255 * 5)));
  return 16 + quantize(rgb[0]) * 36 + quantize(rgb[1]) * 6 + quantize(rgb[2]);
}

function ansi16Index(rgb: Rgb): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  ANSI16.forEach((candidate, index) => {
    const candidateDistance = distance(rgb, candidate);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      best = index;
    }
  });
  return best < 8 && (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 128 ? best + 8 : best;
}

function themeFromEnvironment(env: Record<string, string | undefined>): TuiThemeName {
  const parts = env.COLORFGBG?.split(";");
  const background = Number(parts?.at(-1));
  return Number.isFinite(background) && background >= 7 ? "light" : "dark";
}

export function detectTuiCapabilities(isTTY: boolean, env: Record<string, string | undefined>): TuiCapabilities {
  if (!isTTY) return { colorMode: "none", theme: "dark" };
  const colorMode = /^(truecolor|24bit)$/i.test(env.COLORTERM ?? "")
    ? "truecolor"
    : /256color/i.test(env.TERM ?? "")
      ? "ansi256"
      : "ansi16";
  return { colorMode, theme: themeFromEnvironment(env) };
}

export function styleTuiText(text: string, tone: TuiTone, capabilities: TuiCapabilities): string {
  if (capabilities.colorMode === "none") return text;
  const rgb = PALETTE[capabilities.theme][tone];
  const prefix = capabilities.colorMode === "truecolor"
    ? `\u001b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
    : capabilities.colorMode === "ansi256"
      ? `\u001b[38;5;${ansi256Index(rgb)}m`
      : `\u001b[${ansi16Index(rgb) < 8 ? 30 + ansi16Index(rgb) : 90 + ansi16Index(rgb) - 8}m`;
  return `${prefix}${text}\u001b[39m`;
}
