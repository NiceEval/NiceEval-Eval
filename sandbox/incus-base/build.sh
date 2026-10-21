#!/usr/bin/env bash

set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project="niceeval-eval-dev"
source_image="images:9043ed045f61f207dbd7fc6525671f87b627216bd6707cfe6bebe998a79cda2c"
image_alias="${1:-niceeval-eval-base}"
build_instance="niceeval-base-build-$(date +%s)-$$"
staging_dir="/tmp/niceeval-incus-base"

case "$image_alias" in
  "" | *[!A-Za-z0-9._-]*)
    echo "image alias 只能包含字母、数字、点、下划线和连字符：$image_alias" >&2
    exit 2
    ;;
esac

cleanup() {
  if incus info "$build_instance" --project "$project" >/dev/null 2>&1; then
    incus delete "$build_instance" --project "$project" --force
  fi
}
trap cleanup EXIT INT TERM

if incus image info "$image_alias" --project "$project" >/dev/null 2>&1; then
  echo "目标 alias 已存在，拒绝覆盖：$image_alias" >&2
  echo "重建时先使用候选 alias，例如：./build.sh niceeval-eval-base-candidate" >&2
  exit 1
fi

source_info="$(incus image info "$source_image")"
grep -q '^Type: virtual-machine$' <<<"$source_info"
grep -q '^Fingerprint: 9043ed045f61f207dbd7fc6525671f87b627216bd6707cfe6bebe998a79cda2c$' \
  <<<"$source_info"

echo "创建临时 Ubuntu Noble VM：$build_instance"
incus init "$source_image" "$build_instance" --vm --project "$project"
incus config set "$build_instance" limits.cpu=2 limits.memory=4GiB --project "$project"
incus start "$build_instance" --project "$project"

echo "等待 cloud-init 完成"
incus exec "$build_instance" --project "$project" -- cloud-init status --wait
incus exec "$build_instance" --project "$project" -- mkdir -p "$staging_dir"

for file in \
  provision.sh \
  assets/50-niceeval-dhcp.yaml \
  assets/niceeval-docker-data \
  assets/niceeval-docker-data.service \
  assets/ubuntu.sources
do
  incus file push "$script_dir/$file" \
    "$build_instance$staging_dir/$(basename "$file")" \
    --project "$project"
done

echo "安装固定 runtime 与 guest-init 契约"
incus exec "$build_instance" --project "$project" -- \
  bash "$staging_dir/provision.sh" "$staging_dir"

echo "关闭临时 VM 并发布候选镜像"
incus stop "$build_instance" --project "$project" --timeout 120
incus publish "$build_instance" --project "$project" \
  --alias "$image_alias" \
  description="NiceEval generic disposable Docker VM base" \
  niceeval.guest-init="block-docker-data/v1"

fingerprint="$(
  incus image info "$image_alias" --project "$project" |
    awk '/^Fingerprint:/ { print $2; exit }'
)"
if [[ ! "$fingerprint" =~ ^[a-f0-9]{64}$ ]]; then
  echo "发布后无法读取完整 image fingerprint" >&2
  exit 1
fi

echo "验证新镜像的 block Docker data、runtime 和重启持久性"
"$script_dir/verify.sh" "$image_alias"

echo
echo "候选镜像已构建并验证："
echo "  $image_alias@sha256:$fingerprint"
echo "它尚未写入 it-infra trustedBaseImages，也没有替换项目中的 INCUS_BASE_IMAGE。"
