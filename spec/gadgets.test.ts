import { describe, expect, it } from "vitest";
import { effectiveSpeed, nextTheme } from "../game-logic.ts";

// A slow gadget's timer, while running, cuts the ramped speed by a fixed
// factor; once it lapses, obstacles and gadgets scroll at full speed again.
describe("effectiveSpeed: a slow gadget eases the ramp while its timer runs", () => {
  it("leaves speed unchanged when no slow gadget is active", () => {
    expect(effectiveSpeed(300, false, 0.55)).toBe(300);
  });

  it("scales speed down by the slow factor while active", () => {
    expect(effectiveSpeed(300, true, 0.55)).toBeCloseTo(165, 5);
  });
});

// A theme gadget moves the palette on by one and wraps back to the start,
// whatever the palette's length happens to be.
describe("nextTheme: a theme gadget cycles the palette", () => {
  it("moves to the next theme", () => {
    expect(nextTheme(0, 4)).toBe(1);
  });

  it("wraps back to the first theme after the last", () => {
    expect(nextTheme(3, 4)).toBe(0);
  });
});
