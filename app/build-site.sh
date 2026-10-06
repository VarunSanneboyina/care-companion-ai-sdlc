#!/bin/sh
# Builds one static front-end for Render: copies the shared files in and writes config.js
# so the site knows where the API and its sibling sites live. Usage: sh app/build-site.sh control-room
set -e
SITE="$1"
cd "$(dirname "$0")/web"
[ -d "$SITE" ] || { echo "Unknown site: $SITE"; exit 1; }
mkdir -p "$SITE/shared"
cp shared/* "$SITE/shared/"
printf "window.API_BASE='%s';window.LINKS={controlRoom:'%s',workspace:'%s',patient:'%s'};\n" \
  "${API_URL%/}" "${CONTROL_ROOM_URL%/}/" "${WORKSPACE_URL%/}/" "${PATIENT_URL%/}/" > "$SITE/config.js"
echo "Built $SITE -> API at ${API_URL:-'(same host)'}"
