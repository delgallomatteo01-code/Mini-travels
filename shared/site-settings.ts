export type SiteSettings = {
  paletteVersion?: number;
  appName: string;
  appSubtitle: string;
  travellerOneName: string;
  travellerTwoName: string;
  memoryOneCaption: string;
  memoryTwoCaption: string;
  memoryThreeCaption: string;
  accentColor: string;
  secondaryAccentColor: string;
  backgroundColor: string;
  cardColor: string;
  textColor: string;
  mutedColor: string;
  logoVersion: number;
  travellerOnePhotoVersion: number;
  travellerTwoPhotoVersion: number;
  memoryOneVersion: number;
  memoryTwoVersion: number;
  memoryThreeVersion: number;
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  paletteVersion: 1,
  appName: "M&E Viaggi",
  appSubtitle: "Matteo & Elena",
  travellerOneName: "Matteo",
  travellerTwoName: "Elena",
  memoryOneCaption: "Matteo & Elena",
  memoryTwoCaption: "Noi due",
  memoryThreeCaption: "Ricordi insieme",
  accentColor: "#528019",
  secondaryAccentColor: "#3E641E",
  backgroundColor: "#FFFFFF",
  cardColor: "#FFFFFF",
  textColor: "#000000",
  mutedColor: "#000000",
  logoVersion: 0,
  travellerOnePhotoVersion: 0,
  travellerTwoPhotoVersion: 0,
  memoryOneVersion: 0,
  memoryTwoVersion: 0,
  memoryThreeVersion: 0,
};

export const ASSET_VERSION_KEYS = {
  logo: "logoVersion",
  "traveller-one": "travellerOnePhotoVersion",
  "traveller-two": "travellerTwoPhotoVersion",
  "memory-one": "memoryOneVersion",
  "memory-two": "memoryTwoVersion",
  "memory-three": "memoryThreeVersion",
} as const satisfies Record<string, keyof SiteSettings>;

export type SiteAssetKind = keyof typeof ASSET_VERSION_KEYS;

export function mergeSiteSettings(value: unknown): SiteSettings {
  if (!value || typeof value !== "object") return DEFAULT_SITE_SETTINGS;
  const saved = value as Partial<SiteSettings>;
  const settings = { ...DEFAULT_SITE_SETTINGS, ...saved };
  // Upgrade the existing palette once; subsequent edits remain customizable.
  if (!saved.paletteVersion) {
    return { ...settings, paletteVersion: 1, backgroundColor: "#FFFFFF", cardColor: "#FFFFFF", textColor: "#000000", mutedColor: "#000000" };
  }
  return settings;
}
