# systemd units — VulnTrade log shipper

Host-level units for shipping VulnTrade's rotated Log4j2 output to S3. Designed to be installed by your Terraform's cloud-init, not by the VulnTrade docker-compose stack.

## Files

| Path (in repo) | Install to (on EC2 host) |
|---|---|
| [`../scripts/ship-logs-to-s3.sh`](../scripts/ship-logs-to-s3.sh) | `/usr/local/bin/ship-logs-to-s3.sh` (mode 0755) |
| `vulntrade-log-shipper.service` | `/etc/systemd/system/vulntrade-log-shipper.service` |
| `vulntrade-log-shipper.timer` | `/etc/systemd/system/vulntrade-log-shipper.timer` |
| `log-shipper.env.example` | copy → `/etc/vulntrade/log-shipper.env` and edit |

## Cloud-init snippet

```bash
#!/usr/bin/env bash
set -euo pipefail

# (docker compose + awscli installed earlier in cloud-init)

REPO=/opt/vulntrade
git clone https://github.com/<you>/vulntrade "$REPO"

install -m 0755 "$REPO/scripts/ship-logs-to-s3.sh"         /usr/local/bin/
install -m 0644 "$REPO/systemd/vulntrade-log-shipper.service" /etc/systemd/system/
install -m 0644 "$REPO/systemd/vulntrade-log-shipper.timer"   /etc/systemd/system/

mkdir -p /etc/vulntrade
install -m 0600 "$REPO/systemd/log-shipper.env.example" /etc/vulntrade/log-shipper.env
# (Terraform should template this file with the real S3_BUCKET / AWS_REGION)

systemctl daemon-reload
systemctl enable --now vulntrade-log-shipper.timer

# Bring up VulnTrade (which will start writing logs the shipper can pick up)
cd "$REPO" && docker compose up -d
```

## Sanity checks

```bash
# Timer is armed
systemctl list-timers vulntrade-log-shipper.timer

# One-shot run
systemctl start vulntrade-log-shipper.service
journalctl -u vulntrade-log-shipper.service -n 30

# Shipper script dry-run (useful before timer is live)
S3_BUCKET=vulntrade-logs AWS_REGION=us-east-1 /usr/local/bin/ship-logs-to-s3.sh
```

## Why systemd, not a sidecar

- No extra container in the compose file — VulnTrade stays a focused product.
- Runs with the EC2 instance profile's IAM creds (no long-lived credentials in the container).
- Host-level visibility in `journalctl` — predictable for ops.
- Zero network dependencies inside the app — the app just writes files.
