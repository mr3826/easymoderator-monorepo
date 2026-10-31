import { describe, expect, it } from "vitest";
import { combineLocale } from "../combineLocale";

describe("combineLocale", () => {
  it("preserves app copy for shared keys while adding public-only keys", () => {
    const merged = combineLocale(
      {
        common: { close: "App close", appOnly: "App-only" },
        pricing: {
          mostPopular: "App-approved popularity copy",
          plans: { growth: { description: "Current app plan description" } },
        },
      },
      {
        common: { close: "Public close", publicOnly: "Public-only" },
        pricing: {
          mostPopular: "Marketing copy must not replace app copy",
          plans: { growth: { description: "Marketing description", publicNote: "Public-only note" } },
        },
        publicFunnel: { auth: { email: "Email" } },
      },
    );

    expect(merged.common).toEqual({
      close: "App close",
      appOnly: "App-only",
      publicOnly: "Public-only",
    });
    expect(merged.pricing).toEqual({
      mostPopular: "App-approved popularity copy",
      plans: {
        growth: {
          description: "Current app plan description",
          publicNote: "Public-only note",
        },
      },
    });
    expect(merged.publicFunnel).toEqual({ auth: { email: "Email" } });
  });
});
