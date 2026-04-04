#!/bin/zsh
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: zsh scripts/geocode-hydraulic.sh <input-json> <output-json>" >&2
  exit 1
fi

input="$1"
output="$2"

tmp_output=$(mktemp)
count=$(jq 'length' "$input")
index=0
first=1

printf '[\n' > "$tmp_output"

jq -c '.[]' "$input" | while IFS= read -r row; do
  index=$((index + 1))
  name=$(printf '%s' "$row" | jq -r '.name')
  commune=$(printf '%s' "$row" | jq -r '.commune')
  department=$(printf '%s' "$row" | jq -r '.department')
  region=$(printf '%s' "$row" | jq -r '.region')

  best='{}'
  best_rank='0'

  for query in \
    "centrale hydraulique de ${name} ${commune} ${department}" \
    "usine ${name} ${commune} ${department}" \
    "${name} ${commune} ${department}" \
    "${commune} ${department}" \
    "${name} ${commune}"
  do
    encoded=$(jq -rn --arg value "$query" '$value | @uri')
    response=$(curl -s "https://api-adresse.data.gouv.fr/search/?q=${encoded}&limit=5")
    feature=$(printf '%s' "$response" | jq \
      --arg commune "$commune" \
      --arg department "$department" \
      --arg region "$region" \
      '[
        (.features // [])[]
        | . + {
            __matchScore: (
              (if ((.properties.city // .properties.municipality // "") == $commune) then 4 else 0 end) +
              (if ((.properties.label // "") | contains($commune)) then 2 else 0 end) +
              (if ((.properties.context // "") | contains($department)) then 3 else 0 end) +
              (if ((.properties.context // "") | contains($region)) then 2 else 0 end)
            )
          }
      ]
      | sort_by(-.__matchScore, -(.properties.score // 0))
      | first // {}')
    rank=$(printf '%s' "$feature" | jq '((.__matchScore // 0) * 100000) + (((.properties.score // 0) * 1000) | floor)')
    is_better=$(jq -n --argjson current "$rank" --argjson best "$best_rank" '$current > $best')

    if [[ "$is_better" == 'true' ]]; then
      best=$(printf '%s' "$feature" | jq --arg query "$query" '. + { __query: $query }')
      best_rank="$rank"
    fi

    is_precise=$(printf '%s' "$feature" | jq '((.__matchScore // 0) >= 7) or (((.__matchScore // 0) >= 5) and ((.properties.score // 0) >= 0.30)) or ((.properties.score // 0) >= 0.70)')
    if [[ "$is_precise" == 'true' ]]; then
      break
    fi
  done

  label=$(printf '%s' "$best" | jq -r '.properties.label // ""')
  label_lc=$(printf '%s' "$label" | tr '[:upper:]' '[:lower:]')
  best_score=$(printf '%s' "$best" | jq '.properties.score // 0')
  accuracy='approx'

  if printf '%s' "$label_lc" | rg -q 'usine|barrage|centrale|retenue|route du barrage|chemin du barrage|route de grand maison'; then
    accuracy='site'
  else
    is_commune=$(printf '%s' "$best" | jq '((.__matchScore // 0) >= 5) or ((.properties.score // 0) >= 0.5)')
    if [[ "$is_commune" == 'true' ]]; then
      accuracy='commune'
    fi
  fi

  enriched=$(printf '%s' "$row" | jq \
    --argjson feature "$best" \
    --arg accuracy "$accuracy" \
    '. + {
      lat: ($feature.geometry.coordinates[1] // null),
      lon: ($feature.geometry.coordinates[0] // null),
      geocodeLabel: ($feature.properties.label // null),
      geocodeScore: ($feature.properties.score // 0),
      geocodeQuery: ($feature.__query // null),
      locationAccuracy: $accuracy
    }')

  if [[ $first -eq 0 ]]; then
    printf ',\n' >> "$tmp_output"
  fi
  first=0

  printf '%s' "$enriched" >> "$tmp_output"

  if (( index % 15 == 0 )); then
    echo "geocoded ${index}/${count}" >&2
  fi
done

printf '\n]\n' >> "$tmp_output"
mv "$tmp_output" "$output"

jq '{
  count: length,
  site: (map(select(.locationAccuracy == "site")) | length),
  commune: (map(select(.locationAccuracy == "commune")) | length),
  approx: (map(select(.locationAccuracy == "approx")) | length)
}' "$output"
