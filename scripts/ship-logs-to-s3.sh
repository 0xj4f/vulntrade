#!/usr/bin/env bash
#
# Ship VulnTrade's rotated, gzipped log files from the Docker volume path to S3.
#
# Designed to be run from a systemd timer on the EC2 host (no sidecar).
# Idempotent: successful uploads move the file away, so re-runs are safe.
# Never touches live (un-rotated) files — only *.log.gz produced by Log4j2's
# rollover. Safety: skip files younger than $MIN_AGE_SECONDS to avoid racing
# rotation.
#
# Env:
#   S3_BUCKET          required — e.g. vulntrade-logs
#   AWS_REGION         required — e.g. us-east-1
#   LOG_SRC_DIR        optional — defaults to the repo's logs/vulntrade bind mount
#   MIN_AGE_SECONDS    optional — defaults to 60
#   AWS                optional — path to aws cli binary
#
# IAM required (attached to EC2 instance profile):
#   s3:PutObject on arn:aws:s3:::<bucket>/*
#
set -euo pipefail

S3_BUCKET="${S3_BUCKET:?S3_BUCKET is required}"
AWS_REGION="${AWS_REGION:?AWS_REGION is required}"
MIN_AGE_SECONDS="${MIN_AGE_SECONDS:-60}"
AWS="${AWS:-aws}"
HOSTNAME_SHORT="$(hostname -s)"

# Default to the repo's logs/vulntrade bind mount (docker-compose maps
# ./logs/vulntrade:/var/log/vulntrade). Fall back to auto-detecting a Docker
# named volume for older setups that used one.
if [[ -z "${LOG_SRC_DIR:-}" ]]; then
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    repo_log_dir="$script_dir/../logs/vulntrade"
    if [[ -d "$repo_log_dir" ]]; then
        LOG_SRC_DIR="$repo_log_dir"
    else
        candidate="$(find /var/lib/docker/volumes -maxdepth 2 -type d -name '_data' -path '*vulntrade-logs*' 2>/dev/null | head -n1 || true)"
        if [[ -z "$candidate" ]]; then
            echo "[ship-logs-to-s3] ERROR: could not find logs/vulntrade bind mount or a vulntrade-logs volume; set LOG_SRC_DIR explicitly" >&2
            exit 2
        fi
        LOG_SRC_DIR="$candidate"
    fi
fi

if [[ ! -d "$LOG_SRC_DIR" ]]; then
    echo "[ship-logs-to-s3] ERROR: LOG_SRC_DIR does not exist: $LOG_SRC_DIR" >&2
    exit 2
fi

date_prefix="$(date -u +%Y/%m/%d)"
shipped=0
failed=0

ship_one() {
    local sink="$1"        # "app" or "security"
    local pattern="$2"     # glob to match rotated files for this sink

    while IFS= read -r -d '' src; do
        # Safety: skip files younger than MIN_AGE_SECONDS (may still be rolling)
        if [[ "$(find "$src" -mmin "-$(( MIN_AGE_SECONDS / 60 + 1 ))" -print 2>/dev/null)" == "$src" ]]; then
            # `find -mmin -N` truncates to minute granularity; double-check with stat
            if [[ $(( $(date +%s) - $(stat -c %Y "$src") )) -lt $MIN_AGE_SECONDS ]]; then
                continue
            fi
        fi

        local base
        base="$(basename "$src")"
        local dest="s3://${S3_BUCKET}/${sink}/${date_prefix}/${HOSTNAME_SHORT}/${base}"

        if "$AWS" --region "$AWS_REGION" s3 mv "$src" "$dest" \
               --metadata "host=${HOSTNAME_SHORT},sink=${sink}" \
               --only-show-errors; then
            shipped=$((shipped + 1))
        else
            echo "[ship-logs-to-s3] upload failed: $src -> $dest" >&2
            failed=$((failed + 1))
        fi
    done < <(find "$LOG_SRC_DIR" -maxdepth 1 -type f -name "$pattern" -print0)
}

ship_one "app"      "app-[0-9]*.log.gz"
ship_one "security" "security-[0-9]*.log.gz"   # [0-9] avoids matching security-framework-*.log.gz

echo "[ship-logs-to-s3] shipped=${shipped} failed=${failed} from ${LOG_SRC_DIR}"
[[ $failed -eq 0 ]]
