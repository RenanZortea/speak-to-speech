export type VowelLanguage = "en" | "he" | "pt-BR";
export type VoiceSex = "m" | "f";

export interface VowelReference {
  ipa: string;
  keyword?: string;
  f1: number;
  f2: number;
  f3: number;
}

type RawVowel = [ipa: string, keyword: string | undefined, m: [number, number, number], f: [number, number, number]];

const english: RawVowel[] = [
  ["i", "heed", [343, 2323, 3005], [437, 2761, 3378]],
  ["ɪ", "hid", [429, 2034, 2687], [484, 2369, 3057]],
  ["eɪ", "hayed", [476, 2090, 2688], [535, 2526, 3045]],
  ["ɛ", "head", [588, 1803, 2604], [727, 2063, 2953]],
  ["æ", "had", [591, 1930, 2595], [676, 2335, 2971]],
  ["ɑ", "hod", [756, 1309, 2535], [921, 1524, 2832]],
  ["ɔ", "hawed", [656, 1023, 2521], [804, 1188, 2824]],
  ["oʊ", "hoed", [498, 910, 2459], [555, 1036, 2828]],
  ["ʊ", "hood", [469, 1123, 2435], [519, 1229, 2829]],
  ["u", "who'd", [380, 992, 2355], [460, 1106, 2735]],
  ["ʌ", "hud", [621, 1181, 2548], [760, 1416, 2901]],
  ["ɝ", "heard", [475, 1379, 1708], [524, 1588, 1931]],
];

const hebrew: RawVowel[] = [
  ["i", undefined, [300, 2670, 3320], [325, 2715, 3130]],
  ["e", undefined, [470, 2185, 2470], [540, 2325, 3075]],
  ["a", undefined, [710, 1232, 2720], [880, 1530, 2995]],
  ["o", undefined, [442, 866, 2268], [523, 984, 2965]],
  ["u", undefined, [320, 784, 2576], [384, 886, 2945]],
];

// Gonçalves et al. (2009), Brazilian Journal of Otorhinolaryngology 75(5),
// 680–684. Sustained oral vowels; n=23 men and 23 women, ages 20–45.
const brazilianPortuguese: RawVowel[] = [
  ["i", "piso", [298, 2151, 2925], [362, 2584, 3378]],
  ["e", "peso", [407, 1956, 2540], [437, 2430, 3087]],
  ["ɛ", "peça", [588, 1745, 2566], [672, 2243, 3019]],
  ["a", "pá", [754, 1279, 2483], [1003, 1550, 2960]],
  ["ɔ", "pó", [580, 947, 2526], [715, 1073, 2982]],
  ["o", "avô", [412, 833, 2376], [445, 914, 2900]],
  ["u", "pulo", [345, 800, 2352], [462, 763, 2903]],
];

function select(rows: RawVowel[], sex: VoiceSex): VowelReference[] {
  return rows.map(([ipa, keyword, m, f]) => {
    const [f1, f2, f3] = sex === "m" ? m : f;
    return { ipa, keyword, f1, f2, f3 };
  });
}

export const VOWEL_DATA: Record<VowelLanguage, Record<VoiceSex, VowelReference[]>> = {
  en: { m: select(english, "m"), f: select(english, "f") },
  he: { m: select(hebrew, "m"), f: select(hebrew, "f") },
  "pt-BR": { m: select(brazilianPortuguese, "m"), f: select(brazilianPortuguese, "f") },
};

export const ALL_VOWELS = Object.values(VOWEL_DATA).flatMap((language) => [...language.m, ...language.f]);
