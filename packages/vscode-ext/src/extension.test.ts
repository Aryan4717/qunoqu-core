import { describe, it, expect } from "vitest";
import { hello } from "@qunoqu/core";

describe("vscode-ext", () => {
  it("uses core hello", () => {
    expect(hello()).toBe("qunoqu core");
  });
});
