import { describe, expect, it } from "vitest";
import { oneAtATime } from "./db";

describe("oneAtATime", () => {
  it("runs reads that start together one after another, in order", async () => {
    const events: string[] = [];
    const read = (name: string, ms: number) => async () => {
      events.push(`${name} start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`${name} end`);
      return name;
    };
    const results = await Promise.all([oneAtATime(read("a", 20)), oneAtATime(read("b", 1)), oneAtATime(read("c", 1))]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(events).toEqual(["a start", "a end", "b start", "b end", "c start", "c end"]);
  });

  it("carries on after a read that fails", async () => {
    const failed = oneAtATime(async () => {
      throw new Error("down");
    });
    const next = oneAtATime(async () => "ok");
    await expect(failed).rejects.toThrow("down");
    await expect(next).resolves.toBe("ok");
  });
});
