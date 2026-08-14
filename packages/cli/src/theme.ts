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
  const levels = [0, 95, 135, 175, 215, 255];
  let bestIndex = 16;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let red = 0; red < 6; red += 1) {
    for (let green = 0; green < 6; green += 1) {
      for (let blue = 0; blue < 6; blue += 1) {
        const candidate: Rgb = [levels[red]!, levels[green]!, levels[blue]!];
        const candidateDistance = distance(rgb, candidate);
        if (candidateDistance < bestDistance) {
          bestIndex = 16 + red * 36 + green * 6 + blue;
          bestDistance = candidateDistance;
        }
      }
    }
  }
  for (let gray = 0; gray < 24; gray += 1) {
    const value = 8 + gray * 10;
    const candidateDistance = distance(rgb, [value, value, value]);
    if (candidateDistance < bestDistance) {
      bestIndex = 232 + gray;
      bestDistance = candidateDistance;
    }
  }
  return bestIndex;
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
  return best;
}

function themeFromEnvironment(env: Record<string, string | undefined>): TuiThemeName {
  const parts = env.COLORFGBG?.split(";");
  const background = Number(parts?.at(-1));
  return Number.isFinite(background) && background >= 7 ? "light" : "dark";
}

export function detectTuiCapabilities(isTTY: boolean, env: Record<string, string | undefined>): TuiCapabilities {
  if (!isTTY) return { colorMode: "none", theme: "dark" };
  if (env.NO_COLOR !== undefined || env.TERM?.toLowerCase() === "dumb") {
    return { colorMode: "none", theme: themeFromEnvironment(env) };
  }
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
      : (() => {
        const index = ansi16Index(rgb);
        return `\u001b[${index < 8 ? 30 + index : 90 + index - 8}m`;
      })();
  return `${prefix}${text}\u001b[39m`;
}
