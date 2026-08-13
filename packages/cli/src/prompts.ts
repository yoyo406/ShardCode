import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export async function askForPermission(question: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question(`${question} [y/N] `);
    return ["y", "yes", "o", "oui"].includes(answer.trim().toLowerCase());
  } finally {
    terminal.close();
  }
}
