import { describe, expect, it } from "vitest";
import { readLanguageOverride, readStoredLanguage, storeLanguage, withLanguageOverride } from "../language";

describe("language handoff", () => {
  it.each([
    ["?lang=en", "en"],
    ["?lang=bn", "bn"],
    ["?lang=fr", null],
    ["?lang=EN", null],
    ["?returnTo=https://evil.example&lang=bn", "bn"],
    ["?lang=fr&lang=bn", null],
  ])("accepts only the first allowlisted locale from %s", (search, expected) => {
    expect(readLanguageOverride(search)).toBe(expected);
  });

  it("updates a valid locale in the current URL without dropping other navigation state", () => {
    expect(withLanguageOverride("https://app.easymod.tech/signin?lang=en&next=%2Fdashboard#form", "bn"))
      .toBe("https://app.easymod.tech/signin?lang=bn&next=%2Fdashboard#form");
  });

  it("uses an allowlisted stored locale", () => {
    window.localStorage.setItem("easymod_lang", "en");
    expect(readStoredLanguage()).toBe("en");
    window.localStorage.setItem("easymod_lang", "fr");
    expect(readStoredLanguage()).toBeNull();
  });

  it("keeps locale selection usable when browser storage is blocked", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => { throw new Error("Storage access denied"); },
    });

    expect(readStoredLanguage()).toBeNull();
    expect(() => storeLanguage("bn")).not.toThrow();

    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
  });
});
