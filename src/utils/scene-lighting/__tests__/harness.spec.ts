import { describe, expect, it } from "vitest";

import { escapeHtml } from "@/utils/escapeHtml";

describe("frontend unit test harness", () => {
  it("runs Vitest with the source alias", () => {
    expect(escapeHtml("<scene-lighting>")).toBe("&lt;scene-lighting&gt;");
  });
});
