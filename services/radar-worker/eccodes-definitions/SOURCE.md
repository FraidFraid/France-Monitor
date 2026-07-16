# Météo-France local BUFR definitions

These ecCodes overlay tables are a mechanical conversion of the official
Météo-France radar decoder tables published on 15 May 2025:

- Source: `https://static.data.gouv.fr/resources/documentation-radar/20250515-134259/radar-tables-decodage-20250515.zip`
- SHA-256: `6a5c4f0eb71a5751fbe3d2146e21919573bb0c4c2f994deab2232fbcee92be59`
- Converted inputs: `localtabb_85_*.csv` and `localtabd_85_*.csv`

Only the representation was changed to ecCodes `element.table` and
`sequence.def` syntax. Descriptor numbers, names, units, scales, references,
bit widths, and sequence membership are preserved.
