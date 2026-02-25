import { describe, it, expect } from "vitest";
import { hello } from "@qunoqu/core";

describe("cli", () => {
  it("uses core hello", () => {
    expect(hello()).toBe("qunoqu core");
  });
});
