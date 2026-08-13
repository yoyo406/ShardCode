export type ErrorCategory =
  | "provider_transient"
  | "provider_fatal"
  | "tool_execution"
  | "validation"
  | "permission"
  | "budget"
  | "thrashing"
  | "fatal";

export class ShardCodeError extends Error {
  readonly category: ErrorCategory;
  readonly retryable: boolean;

  constructor(
    message: string,
    category: ErrorCategory,
    options: { retryable?: boolean; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "ShardCodeError";
    this.category = category;
    this.retryable = options.retryable ?? false;
  }
}

export class ProviderError extends ShardCodeError {
  readonly statusCode: number | undefined;

  constructor(
    message: string,
    options: { retryable: boolean; statusCode?: number; cause?: unknown }
  ) {
    super(message, options.retryable ? "provider_transient" : "provider_fatal", options);
    this.name = "ProviderError";
    this.statusCode = options.statusCode;
  }
}

export class ToolExecutionError extends ShardCodeError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, "tool_execution", options);
    this.name = "ToolExecutionError";
  }
}

export class PermissionDeniedError extends ShardCodeError {
  constructor(message: string) {
    super(message, "permission");
    this.name = "PermissionDeniedError";
  }
}

export class BudgetExceededError extends ShardCodeError {
  constructor(message: string) {
    super(message, "budget");
    this.name = "BudgetExceededError";
  }
}

export class ThrashingDetectedError extends ShardCodeError {
  constructor(message: string) {
    super(message, "thrashing");
    this.name = "ThrashingDetectedError";
  }
}

export class ValidationError extends ShardCodeError {
  constructor(message: string) {
    super(message, "validation");
    this.name = "ValidationError";
  }
}
