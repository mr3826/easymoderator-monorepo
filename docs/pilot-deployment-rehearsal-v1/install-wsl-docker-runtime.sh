#!/usr/bin/env bash
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg git xz-utils build-essential python3

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
arch="$(dpkg --print-architecture)"
codename="$(. /etc/os-release && printf '%s' "${VERSION_CODENAME}")"
printf '%s\n' \
  'Types: deb' \
  'URIs: https://download.docker.com/linux/ubuntu' \
  "Suites: ${codename}" \
  'Components: stable' \
  "Architectures: ${arch}" \
  'Signed-By: /etc/apt/keyrings/docker.asc' \
  > /etc/apt/sources.list.d/docker.sources
apt-get update

# Rehearsal versions observed and verified for this candidate. Fail closed if
# the signed repository no longer serves these exact package versions.
docker_pins=(
  'docker-ce=5:29.9.2-1~ubuntu.24.04~noble'
  'docker-ce-cli=5:29.9.2-1~ubuntu.24.04~noble'
  'containerd.io=2.4.2-3~ubuntu.24.04~noble'
  'docker-buildx-plugin=0.38.1-1~ubuntu.24.04~noble'
  'docker-compose-plugin=5.6.1-1~ubuntu.24.04~noble'
)
apt-get install -y "${docker_pins[@]}"

node_version='20.20.2'
node_archive="node-v${node_version}-linux-x64.tar.xz"
node_base="https://nodejs.org/dist/v${node_version}"
curl -fsSL "${node_base}/${node_archive}" -o "/tmp/${node_archive}"
node_hash='df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d'
printf '%s  %s\n' "$node_hash" "/tmp/${node_archive}" | sha256sum --check --status
install -d -m 0755 /opt/nodejs
tar -xJf "/tmp/${node_archive}" -C /opt/nodejs
ln -sfn "/opt/nodejs/node-v${node_version}-linux-x64" /opt/node
ln -sfn /opt/node/bin/node /usr/local/bin/node
ln -sfn /opt/node/bin/npm /usr/local/bin/npm
ln -sfn /opt/node/bin/npx /usr/local/bin/npx

systemctl enable --now docker
systemctl is-active --quiet docker

if [[ -n "$(docker ps -aq)" ]]; then
  printf 'Expected a fresh isolated Docker engine with no containers before Compose.\n' >&2
  exit 1
fi

node --version
npm --version
docker version --format 'Docker Engine server={{.Server.Version}}'
docker compose version
docker version --format '{{.Server.Version}}' | grep -Fx '29.9.2' >/dev/null
docker compose version --short | grep -Fx 'v5.6.1' >/dev/null
node --version | grep -Fx "v${node_version}" >/dev/null
docker info --format 'DockerRootDir={{.DockerRootDir}} Driver={{.Driver}}'
dpkg-query -W -f='${Package}=${Version}\n' \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
