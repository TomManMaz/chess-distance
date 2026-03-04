"""Federation flag utilities.

Ported from lib/federation-flag.ts
"""

from __future__ import annotations

# FIDE 3-letter → ISO 3166-1 alpha-2 mapping for common chess federations
FIDE_TO_ISO: dict[str, str] = {
    "AFG": "AF",
    "ALB": "AL",
    "ALG": "DZ",
    "AND": "AD",
    "ANG": "AO",
    "ARG": "AR",
    "ARM": "AM",
    "AUS": "AU",
    "AUT": "AT",
    "AZE": "AZ",
    "BAN": "BD",
    "BEL": "BE",
    "BER": "BM",
    "BIH": "BA",
    "BLR": "BY",
    "BOL": "BO",
    "BRA": "BR",
    "BUL": "BG",
    "CAM": "KH",
    "CAN": "CA",
    "CHI": "CL",
    "CHN": "CN",
    "COL": "CO",
    "CRC": "CR",
    "CRO": "HR",
    "CUB": "CU",
    "CYP": "CY",
    "CZE": "CZ",
    "DEN": "DK",
    "ECU": "EC",
    "EGY": "EG",
    "ENG": "GB",
    "ESP": "ES",
    "EST": "EE",
    "ETH": "ET",
    "FIN": "FI",
    "FRA": "FR",
    "GAB": "GA",
    "GEO": "GE",
    "GER": "DE",
    "GHA": "GH",
    "GRE": "GR",
    "GUA": "GT",
    "HUN": "HU",
    "INA": "ID",
    "IND": "IN",
    "IRI": "IR",
    "IRL": "IE",
    "IRQ": "IQ",
    "ISL": "IS",
    "ISR": "IL",
    "ITA": "IT",
    "JAM": "JM",
    "JPN": "JP",
    "KAZ": "KZ",
    "KEN": "KE",
    "KOR": "KR",
    "KOS": "XK",
    "KUW": "KW",
    "LAT": "LV",
    "LBA": "LY",
    "LIE": "LI",
    "LTU": "LT",
    "LUX": "LU",
    "MAR": "MA",
    "MAS": "MY",
    "MEX": "MX",
    "MGL": "MN",
    "MKD": "MK",
    "MLT": "MT",
    "MNE": "ME",
    "MOZ": "MZ",
    "MRI": "MU",
    "MYA": "MM",
    "NAM": "NA",
    "NED": "NL",
    "NGR": "NG",
    "NOR": "NO",
    "NZL": "NZ",
    "PAK": "PK",
    "PAN": "PA",
    "PER": "PE",
    "PHI": "PH",
    "POL": "PL",
    "POR": "PT",
    "PUR": "PR",
    "QAT": "QA",
    "ROU": "RO",
    "RSA": "ZA",
    "RUS": "RU",
    "SCO": "GB",
    "SEN": "SN",
    "SRB": "RS",
    "SRI": "LK",
    "SUI": "CH",
    "SVK": "SK",
    "SVN": "SI",
    "SWE": "SE",
    "SYR": "SY",
    "TAN": "TZ",
    "THA": "TH",
    "TTO": "TT",
    "TUN": "TN",
    "TUR": "TR",
    "UAE": "AE",
    "UGA": "UG",
    "UKR": "UA",
    "URU": "UY",
    "USA": "US",
    "UZB": "UZ",
    "VEN": "VE",
    "VIE": "VN",
    "WLS": "GB",
    "YEM": "YE",
    "ZIM": "ZW",
}


def iso_to_flag(iso: str) -> str:
    """Convert a 2-letter ISO country code to a flag emoji.

    Builds Unicode regional indicator pairs (0x1F1E6-0x1F1FF for A-Z).

    Examples:
        'US' → '🇺🇸'
        'FR' → '🇫🇷'
        'GB' → '🇬🇧'
    """
    upper = iso.upper()
    if len(upper) != 2:
        return ""
    # Regional Indicator base: 0x1F1E6 for 'A'
    base = 0x1F1E6 - ord("A")
    try:
        return chr(base + ord(upper[0])) + chr(base + ord(upper[1]))
    except (ValueError, OverflowError):
        return ""


def fide_to_flag(fide_code: str | None) -> str:
    """Return the flag emoji for a FIDE federation code, or an empty string
    if the code is unknown.

    Examples:
        'USA' → '🇺🇸'
        'RUS' → '🇷🇺'
        'FRA' → '🇫🇷'
        'XXX' → ''
    """
    if not fide_code:
        return ""
    iso = FIDE_TO_ISO.get(fide_code.upper())
    if not iso:
        return ""
    return iso_to_flag(iso)
