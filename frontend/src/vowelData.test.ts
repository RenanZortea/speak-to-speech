import { describe, expect, it } from "vitest";
import { VOWEL_DATA } from "./vowelData";

describe("vowel reference data", () => {
  it("contains every reference group with plausible ordered formants", () => {
    expect(VOWEL_DATA.en.m).toHaveLength(12);
    expect(VOWEL_DATA.en.f).toHaveLength(12);
    expect(VOWEL_DATA.he.m).toHaveLength(5);
    expect(VOWEL_DATA.he.f).toHaveLength(5);
    for (const language of Object.values(VOWEL_DATA)) for (const group of Object.values(language)) for (const vowel of group) {
      expect(vowel.f1).toBeGreaterThan(200);
      expect(vowel.f1).toBeLessThan(vowel.f2);
      expect(vowel.f2).toBeLessThan(vowel.f3);
      expect(vowel.f3).toBeLessThan(4000);
    }
  });
});
