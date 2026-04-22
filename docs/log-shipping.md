# Log Shipping to S3

How VulnTrade's structured JSON logs reach an S3 bucket so a downstream SIEM (Wazuh, in your case, in a separate repo) can consume them.

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

An S3 event notification (`s3:ObjectCreated:*`) on this bucket feeds SQS; Wazuh's `aws-s3` wodle consumes from SQS. All of that lives in your Wazuh / infra repo, not here.

---

## 2. Where the logs come from

Inside the backend container, Log4j2 writes:

- `/var/log/vulntrade/app.log` — **raw** sink (user-controlled fields kept verbatim; intentional log-injection teaching surface)
- `/var/log/vulntrade/security.log` — **sanitized** sink (safe for SIEM ingestion)

Both rotate on time+size (current config: daily / 50 MB), producing gzipped files named `*-YYYY-MM-DD-N.log.gz`.

Docker Compose already exposes these via the `vulntrade-logs` named volume:

```yaml
# docker-compose.yml (already present)
services:
  backend:
    volumes:
      - vulntrade-logs:/var/log/vulntrade
volumes:
  vulntrade-logs:
```

On the EC2 host, Docker places this at `/var/lib/docker/volumes/<project>_vulntrade-logs/_data/`. We ship directly from that path.

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
- `LOG_SRC_DIR` (optional; defaults to the Docker volume path above)
- `AWS` (optional; defaults to `/usr/local/bin/aws` — let your PATH resolve if using `apt install awscli`)

IAM for the instance profile (minimal):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:PutObjectAcl"],
    "Resource": "arn:aws:s3:::vulntrade-logs/*"
  }]
}
```

---

## 4. The systemd units

`systemd/vulntrade-log-shipper.service` (see [`../systemd/vulntrade-log-shipper.service`](../systemd/vulntrade-log-shipper.service)) — oneshot that runs the script once.

`systemd/vulntrade-log-shipper.timer` (see [`../systemd/vulntrade-log-shipper.timer`](../systemd/vulntrade-log-shipper.timer)) — fires every minute.

Installed in your cloud-init (one-liner): copy the two unit files to `/etc/systemd/system/`, copy the script to `/usr/local/bin/`, `systemctl enable --now vulntrade-log-shipper.timer`.

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

## 6. Terraform hand-off

Your Terraform is the source of truth for:

- The S3 bucket (`vulntrade-logs`), with server-side encryption, lifecycle to Glacier/deep-archive, and object-lock if you want WORM.
- The SQS queue + S3 event notification.
- The EC2 instance profile with the IAM policy in §3.
- Cloud-init: install `docker`, `docker compose plugin`, `awscli`, then `systemctl enable --now vulntrade-log-shipper.timer` after copying the three files from this repo.

This repo does NOT own those resources — it owns only:
1. The app emitting the right log shape.
2. The shipping script + systemd units under `scripts/` and `systemd/`.

Terraform clones this repo at provision time, references those three files via a local path, and drops them into `/usr/local/bin/` and `/etc/systemd/system/` during cloud-init.

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

# 2. Wait for Log4j2 to gzip-roll at 50MB or force via size trigger
ls /var/lib/docker/volumes/*_vulntrade-logs/_data/ | grep gz

# 3. Trigger the shipper manually
sudo systemctl start vulntrade-log-shipper.service

# 4. Verify object landed in S3
aws s3 ls s3://vulntrade-logs/security/$(date -u +%Y/%m/%d)/ --recursive
```

If the Wazuh side is wired, you should also see the S3 → SQS event fire and the Wazuh manager's aws-s3 wodle pull the object a minute later.
