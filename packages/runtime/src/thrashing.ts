import type { ToolResult } from "@shardcode/shared";

export class ThrashingDetector {
  private previousSignature: string | undefined;
  private count = 0;

  constructor(private readonly threshold = 3) {}

  observe(result: ToolResult): boolean {
    if (result.status === "completed") {
      this.previousSignature = undefined;
      this.count = 0;
      return false;
    }
    const signature = [result.toolName, result.error?.code ?? "unknown", result.output.replace(/\s+/g, " ").trim()].join("|");
    if (signature === this.previousSignature) this.count += 1;
    else {
      this.previousSignature = signature;
      this.count = 1;
    }
    return this.count >= this.threshold;
  }

  currentCount(): number {
    return this.count;
  }
}
