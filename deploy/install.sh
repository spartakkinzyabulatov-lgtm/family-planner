#!/bin/bash
# First installation only. Must be explicitly approved before running on the server.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$(id -u)" -ne 0 ]; then echo 'Run as root on the server.' >&2; exit 1; fi
for tool in ufw apt-get systemctl ss getent useradd install runuser python3; do
    if ! command -v "$tool" >/dev/null 2>&1; then echo "Required command unavailable: $tool" >&2; exit 1; fi
done
for target in /opt/family-planner /var/lib/family-planner /etc/systemd/system/family-planner.service /etc/systemd/system/family-planner-proxy.service /etc/caddy/family-planner.Caddyfile; do
    if [ -e "$target" ]; then echo "Refusing to overwrite existing path: $target" >&2; exit 1; fi
done
if command -v caddy >/dev/null 2>&1; then echo 'Caddy already exists. Review its configuration separately.' >&2; exit 1; fi
if ss -ltnH '( sport = :80 or sport = :443 or sport = :8787 )' | read -r _; then echo 'A required port is occupied.' >&2; exit 1; fi
if getent passwd family-planner >/dev/null; then echo 'Service account already exists. Review separately.' >&2; exit 1; fi
apt-get update
apt-get install -y caddy
# Stop only the default service just installed above. Use a separate configuration and service.
systemctl disable --now caddy
useradd --system --user-group --home-dir /var/lib/family-planner --shell /usr/sbin/nologin family-planner
install -d -m 755 /opt/family-planner
install -m 644 "$SOURCE_DIR/server/server.py" /opt/family-planner/server.py
install -d -o family-planner -g family-planner -m 700 /var/lib/family-planner
install -m 644 "$SOURCE_DIR/deploy/family-planner.service" /etc/systemd/system/family-planner.service
install -m 644 "$SOURCE_DIR/deploy/family-planner-proxy.service" /etc/systemd/system/family-planner-proxy.service
install -m 644 "$SOURCE_DIR/deploy/Caddyfile.example" /etc/caddy/family-planner.Caddyfile
caddy validate --config /etc/caddy/family-planner.Caddyfile --adapter caddyfile
# Read PIN from the terminal; only its salted hash is stored in the private database.
runuser -u family-planner -- python3 /opt/family-planner/server.py init-pin --database /var/lib/family-planner/data.sqlite
ufw allow 80/tcp comment 'Family planner HTTPS validation'
ufw allow 443/tcp comment 'Family planner HTTPS'
systemctl daemon-reload
systemctl enable --now family-planner.service family-planner-proxy.service
systemctl is-active family-planner.service family-planner-proxy.service
