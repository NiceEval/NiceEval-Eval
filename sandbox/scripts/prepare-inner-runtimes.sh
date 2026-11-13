#!/bin/sh
# 以 root 在 Instabox 实例里执行一次，结果由远端快照缓存。
# 准备 Node 24、固定版本的 pnpm、凭据目录与官方 Codex CLI，并从固定 digest 准备两枚 inner runtime 镜像。
# 调用方在前面定义：codex_version、node_source、python_source。
set -eu
printf '%s\n' '初始化沙箱 Node 24 与固定 pnpm toolchain…'
rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
curl -fsSL https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz | tar -xJf - -C /usr/local --strip-components=1
mkdir -p /opt/niceeval-toolchain/bin
corepack enable --install-directory /opt/niceeval-toolchain/bin
ln -sf /opt/niceeval-toolchain/bin/pnpm /usr/local/bin/pnpm
ln -sf /opt/niceeval-toolchain/bin/pnpx /usr/local/bin/pnpx
corepack prepare pnpm@11.12.0 --activate
box_user="$(id -un 1000 2>/dev/null || id -un)"
box_home="$(eval echo "~$box_user")"
setpriv --reuid="$box_user" --regid="$box_user" --init-groups env HOME="$box_home" corepack prepare pnpm@11.12.0 --activate 2>/dev/null || true
mkdir -p /opt/fixture-secrets
chown -R "$box_user:$box_user" /opt/fixture-secrets

printf '在基础镜像中预安装官方 Codex CLI %s…\n' "$codex_version"
npm install -g "@openai/codex@$codex_version"
mkdir -p "$box_home/.local/bin"
ln -sf /usr/local/bin/codex "$box_home/.local/bin/codex"
chown -R "$box_user:$box_user" "$box_home/.local"

node_tag=cache.invalid/niceeval-harness/runtime:node
harness_python_tag=cache.invalid/niceeval-harness/runtime:python
install_python_tag=cache.invalid/niceeval-install/runtime:python
build_dir="$(mktemp -d)"
node_container=
python_container=
cleanup() {
  [ -z "$node_container" ] || docker rm -f "$node_container" >/dev/null 2>&1 || true
  [ -z "$python_container" ] || docker rm -f "$python_container" >/dev/null 2>&1 || true
  rm -rf "$build_dir"
}
trap cleanup EXIT
pull_fixed() {
  image="$1"
  attempt=1
  while ! docker pull "$image"; do
    if [ "$attempt" -ge 3 ]; then
      printf '固定镜像拉取连续 %s 次失败：%s\n' "$attempt" "$image" >&2
      return 1
    fi
    delay=$((attempt * 2))
    printf '固定镜像拉取失败，%s 秒后重试（%s/3）：%s\n' "$delay" "$attempt" "$image" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

printf '%s\n' '拉取固定 digest 的 inner runtime sources…'
pull_fixed "$node_source"
pull_fixed "$python_source"
docker image tag "$node_source" "$node_tag"

node_container="$(docker create "$node_source")"
python_container="$(docker create "$python_source")"
docker cp "$node_container:/usr/local/bin/node" "$build_dir/node"
docker cp "$build_dir/node" "$python_container:/usr/local/bin/node"
docker cp "$build_dir/node" "$python_container:/usr/local/bin/nodejs"
docker export "$python_container" | docker import - "$harness_python_tag"
docker image tag "$harness_python_tag" "$install_python_tag"

docker run --pull=never --rm --entrypoint /bin/sh "$node_tag" \
  -c 'node -v && git --version && ! command -v python3'
docker run --pull=never --rm --entrypoint /bin/sh "$harness_python_tag" \
  -c 'node -v && git --version && python3 --version'

cleanup
trap - EXIT

printf '%s\n' '沙箱基础环境与 inner runtime 镜像准备完成'
