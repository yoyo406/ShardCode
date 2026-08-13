import type { ToolCall, ToolDefinition, ToolInvoker } from "@shardcode/shared";

export interface RepositoryContext {
  files: string[];
  matches: string;
}

export class ContextEngine {
  constructor(private readonly tools: ToolInvoker) {}

  async explore(): Promise<RepositoryContext> {
    const listResult = await this.tools.execute({ id: "context-list", name: "list_files", input: {} });
    const grepResult = await this.tools.execute({
      id: "context-grep",
      name: "grep",
      input: { pattern: "(TODO|FIXME|export|class|function)" }
    });
    return {
      files: listResult.status === "completed" ? listResult.output.split("\n").filter(Boolean) : [],
      matches: grepResult.status === "completed" ? grepResult.output : ""
    };
  }

  definitions(): ToolDefinition[] {
    return this.tools.definitions();
  }
}
