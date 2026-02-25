import { describe, it, expect } from "vitest";
import { hello } from "./index";

describe("core", () => {
  it("hello returns qunoqu core", () => {
    expect(hello()).toBe("qunoqu core");
  });
});
