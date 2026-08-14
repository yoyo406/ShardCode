import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const ANSI_OSC = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const C1_OSC = /\u009d[^\u0007\u009c]*(?:\u0007|\u009c|\u001b\\)/g;
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_C1_CSI = /\u009b[0-?]*[ -/]*[@-~]/g;
const ANSI_SINGLE = /\u001b[@-_]/g;

function sanitizePermissionPrompt(question: string): string {
  return question
    .replace(ANSI_OSC, "")
    .replace(C1_OSC, "")
    .replace(ANSI_CSI, "")
    .replace(ANSI_C1_CSI, "")
    .replace(ANSI_SINGLE, "")
    .replace(/\u001b/g, "")
    .replace(/[\u0080-\u009f]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "");
}

export function formatPermissionPrompt(question: string, style?: (text: string) => string): string {
  const prompt = `${sanitizePermissionPrompt(question)} [y/N]`;
  return style ? style(prompt) : prompt;
}

export async function askForPermission(question: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question(`${formatPermissionPrompt(question)} `);
    return ["y", "yes", "o", "oui"].includes(answer.trim().toLowerCase());
  } finally {
    terminal.close();
  }
}
