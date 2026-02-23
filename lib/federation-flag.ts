/**
 * Converts a FIDE 3-letter federation code to a flag emoji.
 * FIDE uses IOC-style codes, which differ from ISO 3166-1 alpha-2.
 */

// FIDE 3-letter → ISO 3166-1 alpha-2 mapping for common chess federations
const FIDE_TO_ISO: Record<string, string> = {
  AFG: "AF", ALB: "AL", ALG: "DZ", AND: "AD", ANG: "AO", ARG: "AR",
  ARM: "AM", AUS: "AU", AUT: "AT", AZE: "AZ", BAN: "BD", BEL: "BE",
  BER: "BM", BIH: "BA", BLR: "BY", BOL: "BO", BRA: "BR", BUL: "BG",
  CAM: "KH", CAN: "CA", CHI: "CL", CHN: "CN", COL: "CO", CRC: "CR",
  CRO: "HR", CUB: "CU", CYP: "CY", CZE: "CZ", DEN: "DK", ECU: "EC",
  EGY: "EG", ENG: "GB", ESP: "ES", EST: "EE", ETH: "ET", FIN: "FI",
  FRA: "FR", GAB: "GA", GEO: "GE", GER: "DE", GHA: "GH", GRE: "GR",
  GUA: "GT", HUN: "HU", INA: "ID", IND: "IN", IRI: "IR", IRL: "IE",
  IRQ: "IQ", ISL: "IS", ISR: "IL", ITA: "IT", JAM: "JM", JPN: "JP",
  KAZ: "KZ", KEN: "KE", KOR: "KR", KOS: "XK", KUW: "KW", LAT: "LV",
  LBA: "LY", LIE: "LI", LTU: "LT", LUX: "LU", MAR: "MA", MAS: "MY",
  MEX: "MX", MGL: "MN", MKD: "MK", MLT: "MT", MNE: "ME", MOZ: "MZ",
  MRI: "MU", MYA: "MM", NAM: "NA", NED: "NL", NGR: "NG", NOR: "NO",
  NZL: "NZ", PAK: "PK", PAN: "PA", PER: "PE", PHI: "PH", POL: "PL",
  POR: "PT", PUR: "PR", QAT: "QA", ROU: "RO", RSA: "ZA", RUS: "RU",
  SCO: "GB", SEN: "SN", SRB: "RS", SRI: "LK", SUI: "CH", SVK: "SK",
  SVN: "SI", SWE: "SE", SYR: "SY", TAN: "TZ", THA: "TH", TTO: "TT",
  TUN: "TN", TUR: "TR", UAE: "AE", UGA: "UG", UKR: "UA", URU: "UY",
  USA: "US", UZB: "UZ", VEN: "VE", VIE: "VN", WLS: "GB", YEM: "YE",
  ZIM: "ZW",
};

/** Convert a 2-letter ISO country code to a flag emoji. */
function isoToFlag(iso: string): string {
  const upper = iso.toUpperCase();
  // Regional Indicator base: 0x1F1E6 for 'A'
  const base = 0x1F1E6 - 65;
  return String.fromCodePoint(base + upper.charCodeAt(0), base + upper.charCodeAt(1));
}

/**
 * Returns the flag emoji for a FIDE federation code, or an empty string
 * if the code is unknown.
 */
export function federationFlag(federation: string | null | undefined): string {
  if (!federation) return "";
  const iso = FIDE_TO_ISO[federation.toUpperCase()];
  if (!iso) return "";
  return isoToFlag(iso);
}
