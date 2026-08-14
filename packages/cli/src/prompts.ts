import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export function formatPermissionPrompt(question: string, style?: (text: string) => string): string {
  const prompt = `${question} [y/N]`;
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
