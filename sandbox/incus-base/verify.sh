#!/usr/bin/env bash

set -euo pipefail

image="${1:-niceeval-eval-base}"
project="niceeval-eval-dev"
pool="niceeval-sandbox-dev"
suffix="$(date +%s)-$$"
verify_instance="niceeval-base-verify-$suffix"
verify_volume="niceeval-base-verify-$suffix-dd"

cleanup() {
  if incus info "$verify_instance" --project "$project" >/dev/null 2>&1; then
    incus delete "$verify_instance" --project "$project" --force
  fi
  if incus storage volume show "$pool" "$verify_volume" \
    --project "$project" >/dev/null 2>&1; then
    incus storage volume delete "$pool" "$verify_volume" --project "$project"
  fi
}
trap cleanup EXIT INT TERM

image_info="$(incus image info "$image" --project "$project")"
grep -q '^Type: virtual-machine$' <<<"$image_info"
image_yaml="$(incus image show "$image" --project "$project")"
grep -q '^  niceeval.guest-init: block-docker-data/v1$' <<<"$image_yaml"

incus storage volume create "$pool" "$verify_volume" \
  --project "$project" --type block size=4GiB
incus init "$image" "$verify_instance" --vm --project "$project"
incus storage volume attach "$pool" "$verify_volume" "$verify_instance" dockerdata \
  --project "$project"
incus start "$verify_instance" --project "$project"

for _ in $(seq 1 120); do
  if incus exec "$verify_instance" --project "$project" -- true >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

for _ in $(seq 1 120); do
  if incus exec "$verify_instance" --project "$project" -- \
    systemctl is-active --quiet niceeval-docker-data.service docker.service \
    >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
incus exec "$verify_instance" --project "$project" -- \
  systemctl is-active --quiet niceeval-docker-data.service docker.service

incus exec "$verify_instance" --project "$project" -- bash -lc '
  set -euo pipefail
  test "$(id -u node)" = 1000
  case "$(node --version)" in v24.*) ;; *) exit 1 ;; esac
  test "$(pnpm --version)" = 11.12.0
  test "$(findmnt --noheadings --output FSTYPE --mountpoint /var/lib/docker)" = ext4
  test -n "$(cat /etc/machine-id)"
  docker info >/dev/null
  docker compose version
  printf verified > /var/lib/docker/.niceeval-base-verify
  sync
'

incus restart "$verify_instance" --project "$project" --timeout 120
for _ in $(seq 1 120); do
  if incus exec "$verify_instance" --project "$project" -- \
    systemctl is-active --quiet niceeval-docker-data.service docker.service \
    >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
incus exec "$verify_instance" --project "$project" -- \
  systemctl is-active --quiet niceeval-docker-data.service docker.service
incus exec "$verify_instance" --project "$project" -- \
  sh -lc 'test "$(cat /var/lib/docker/.niceeval-base-verify)" = verified'

echo "Incus base 验证通过：$image"
