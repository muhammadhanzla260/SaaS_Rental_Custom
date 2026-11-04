#!/bin/sh
# Prototype CSS names fonts literally; the self-hosted faces are only reachable through these variables.
grep -rlE "'(Geist|Bricolage Grotesque|Geist Mono)'" "$@" | xargs -r sed -i -E \
  -e "s/'Geist Mono', ?ui-monospace, ?monospace/var(--font-mono)/g" \
  -e "s/'Bricolage Grotesque', ?(system-ui, ?)?sans-serif/var(--font-display)/g" \
  -e "s/'Geist', ?(system-ui, ?)?sans-serif/var(--font-ui)/g"
