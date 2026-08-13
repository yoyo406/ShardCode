import { describe, expect, it } from "vitest";
import { createEvent } from "./events.js";

describe("event stream", () => {
  it("creates serializable events with identity and timestamp", () => {
    const event = createEvent("session-1", "ToolCompleted", {
      toolName: "read_file"
    });

    expect(event.id).toEqual(expect.any(String));
    expect(event.sessionId).toBe("session-1");
    expect(event.timestamp).toEqual(expect.any(String));
    expect(new Date(event.timestamp).toString()).not.toBe("Invalid Date");
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });
});
