# Log Shipping to S3

How VulnTrade's structured JSON logs reach an S3 bucket so a downstream SIEM (for example Wazuh) can consume them.

Design goal: **simplest possible shipping path**. No sidecars. No streaming daemons. Rotated files, a single shell script, a systemd timer on the EC2 host. The VulnTrade stack itself only cares about writing good logs — shipping is a host-level concern bolted on.

---

## 1. Contract (what ends up in S3)

One bucket, per-sink prefixes, date-partitioned, host-tagged. Each object is one rotated, gzipped JSON-lines file produced by Log4j2.

```
s3://vulntrade-logs/
├── app/
│   └── YYYY/MM/DD/<host>/app-YYYY-MM-DD-N.log.gz
└── security/
    └── YYYY/MM/DD/<host>/security-YYYY-MM-DD-N.log.gz
```

| Property | Value |
|---|---|
| Object format | gzipped JSONL — one canonical event per line |
| Event schema | `docs/logging-guide.md` |
| Sink separation | prefix (`app/` vs `security/`) — matches the `log_source` field |
| Encoding | UTF-8 JSON, no BOM |
| Compression | gzip (Log4j2's `filePattern="*.log.gz"`) |
| Immutability | objects never overwritten; unique filename per rotation |
| Metadata | S3 object metadata includes `x-amz-meta-host` and `x-amz-meta-sink` |

An S3 event notification (`s3:ObjectCreated:*`) on this bucket feeds SQS; Wazuh's `aws-s3` wodle consumes from SQS. Setting up the queue and the SIEM side is outside VulnTrade's scope.

---

## 2. Where the logs come from

Inside the backend container, Log4j2 writes:

- `/var/log/vulntrade/app.log` — **raw** sink (user-controlled fields kept verbatim; intentional log-injection teaching surface)
- `/var/log/vulntrade/security.log` — **sanitized** sink (safe for SIEM ingestion)

Both rotate on time+size (current config: daily / 50 MB), producing gzipped files named `*-YYYY-MM-DD-N.log.gz`.

Docker Compose already exposes these via a host **bind mount** at `./logs/vulntrade`:

```yaml
# docker-compose.yml (already present)
services:
  backend:
    volumes:
      - ./logs/vulntrade:/var/log/vulntrade   # structured JSON logs (bind mount for SIEM/S3)
```

On the host, the rotated files land in the repo's `logs/vulntrade/` directory, and the shipping
script reads directly from there (`LOG_SRC_DIR` defaults to it, falling back to auto-detecting a
`*vulntrade-logs*` Docker named volume for older setups that used one).

---

## 3. The shipping script

One shell script, run from a systemd timer. Zero container involvement.

`scripts/ship-logs-to-s3.sh` (see [`../scripts/ship-logs-to-s3.sh`](../scripts/ship-logs-to-s3.sh)):

Behavior:
- Finds only **rotated** files (`*-*.log.gz`) — never touches the live `app.log` / `security.log`, so no racing with Log4j2's file handle.
- Only ships files older than 60 seconds (safety buffer for rotation completion).
- Uses `aws s3 mv` — on success the local file is removed, which gives free disk hygiene.
- Computes the date prefix from `date -u +%Y/%m/%d` at upload time.
- Adds `x-amz-meta-host` and `x-amz-meta-sink` metadata.
- Idempotent: re-running won't re-upload already-shipped files (they're moved away).

Environment it needs:
- `S3_BUCKET` (required)
- `AWS_REGION` (required; EC2 instance profile otherwise provides creds)
- `LOG_SRC_DIR` (optional; defaults to the repo's `logs/vulntrade` bind mount, falling back to a `*vulntrade-logs*` Docker named volume)
- `MIN_AGE_SECONDS` (optional; defaults to `60` — skip files younger than this to avoid racing rotation)
- `AWS` (optional; defaults to `aws` resolved from `PATH`)

IAM for the instance profile (minimal):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject"],
    "Resource": "arn:aws:s3:::vulntrade-logs/*"
  }]
}
```

---

## 4. The systemd units

`wazuh/systemd/vulntrade-log-shipper.service` (see [`../wazuh/systemd/vulntrade-log-shipper.service`](../wazuh/systemd/vulntrade-log-shipper.service)) — oneshot that runs the script once; reads its config from `/etc/vulntrade/log-shipper.env` (template: `wazuh/systemd/log-shipper.env.example`).

`wazuh/systemd/vulntrade-log-shipper.timer` (see [`../wazuh/systemd/vulntrade-log-shipper.timer`](../wazuh/systemd/vulntrade-log-shipper.timer)) — fires 30s after boot, then every minute.

Install one-liner: copy the two unit files to `/etc/systemd/system/`, the script to `/usr/local/bin/ship-logs-to-s3.sh`, the env template to `/etc/vulntrade/log-shipper.env` (fill in `S3_BUCKET` / `AWS_REGION`), then `systemctl enable --now vulntrade-log-shipper.timer`.

---

## 5. Live-log visibility (optional, for dev)

Batch shipping means up to ~1 minute of lag + rotation delay. Fine for SIEM. If you want real-time during local dev:

```bash
docker compose logs -f backend | grep -E '^\{.*"eventType"'
```

For lab practice you usually don't need streaming — you trigger an exploit, wait a minute, look in S3.

If near-real-time to S3 becomes important later, two options that stay sidecar-free:
- Shorten rotation interval to 1 minute (`Policies/SizeBasedTriggeringPolicy` → 1 MB, or a `CronTriggeringPolicy`).
- Run `vector` as a **systemd service on the host** (one static binary, not a container) tailing the live files.

Both are additions; we don't default to them.

---

## 6. Infrastructure you provide

Provision these yourself (for example with Terraform):

- The S3 bucket (`vulntrade-logs`), with server-side encryption, lifecycle to Glacier/deep-archive, and object-lock if you want WORM.
- The SQS queue + S3 event notification.
- The EC2 instance profile with the IAM policy in §3.
- Cloud-init: install `docker`, `docker compose plugin`, `awscli`, then `systemctl enable --now vulntrade-log-shipper.timer` after copying the shipper files from this repo.

VulnTrade does not create those resources. It provides only:
1. The app emitting the right log shape.
2. The shipping script under `scripts/` and the systemd units (+ env template) under `wazuh/systemd/`, which your provisioning copies into `/usr/local/bin/`, `/etc/systemd/system/` and `/etc/vulntrade/`.

---

## 7. Smoke test

On the EC2 host, after bringing up the stack:

```bash
# 1. Trigger a rotation to produce a shippable file quickly
docker compose exec backend bash -c 'for i in $(seq 1 1000); do \
    curl -s -X POST http://localhost:8085/api/auth/login \
         -H "Content-Type: application/json" \
         -d "{\"username\":\"u$i\",\"password\":\"x\"}" > /dev/null; \
  done'

# 2. Wait for Log4j2 to gzip-roll (daily, or at 50MB) and list the rotated files
ls logs/vulntrade/ | grep gz

# 3. Trigger the shipper manually
sudo systemctl start vulntrade-log-shipper.service

# 4. Verify object landed in S3
aws s3 ls s3://vulntrade-logs/security/$(date -u +%Y/%m/%d)/ --recursive
```

If the Wazuh side is wired, you should also see the S3 → SQS event fire and the Wazuh manager's aws-s3 wodle pull the object a minute later.
