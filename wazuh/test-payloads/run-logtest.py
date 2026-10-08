#!/usr/bin/env python3
"""Replay cases.jsonl through wazuh-logtest and assert the final rule id of each event.

Each case is a raw VulnTrade log record. It is wrapped exactly as the aws-s3 wodle
emits it after Fluent Bit parsing ({"integration":"aws","aws":{...}}, scalars
stringified), so the test exercises the real decode path, not the app's raw schema.

All cases run in ONE logtest session, in file order, so frequency / correlation
rules see their preceding events. Cases with "expect": null only feed a sequence.

Usage:
  ./run-logtest.py <instance-id> [--region eu-west-1]   # manager over SSM (needs AWS creds)
  ./run-logtest.py --docker vt-wazuh                    # local wazuh/wazuh-manager container
"""
import argparse, base64, gzip, json, pathlib, re, subprocess, sys, time

HERE = pathlib.Path(__file__).parent


def stringify(v):
    """Turn every scalar into a string like the wodle does. None values are dropped."""
    if isinstance(v, dict):
        return {k: stringify(x) for k, x in v.items() if x is not None}
    if isinstance(v, bool):
        return "true" if v else "false"
    return v if isinstance(v, str) else str(v)


def wrap(case):
    sink = case["sink"]
    aws = {
        "log_info": {"log_file": f"vulntrade/vulntrade.{sink}/2026/09/29/11_00_00-TEST.gz",
                     "s3bucket": "wazuh-application-logs-872515260040"},
        "timestamp": "2026-09-29T11:00:00.000000Z",
    }
    aws.update(stringify(case["log"]))
    aws["source_file"] = f"/var/log/vulntrade/{sink}.log"
    aws["source"] = "custom"
    return json.dumps({"integration": "aws", "aws": aws})


def ssm(instance, region, script):
    b64 = base64.b64encode(script.encode()).decode()
    params = json.dumps({"commands": [f"echo {b64} | base64 -d | bash"]})
    cid = subprocess.check_output(
        ["aws", "ssm", "send-command", "--region", region, "--instance-ids", instance,
         "--document-name", "AWS-RunShellScript", "--comment", "vulntrade rules logtest (read-only)",
         "--parameters", params, "--query", "Command.CommandId", "--output", "text"], text=True).strip()
    while True:
        time.sleep(4)
        out = json.loads(subprocess.check_output(
            ["aws", "ssm", "get-command-invocation", "--region", region, "--instance-id", instance,
             "--command-id", cid, "--output", "json"], text=True))
        if out["Status"] not in ("Pending", "InProgress", "Delayed"):
            return out["StandardOutputContent"]


def docker(container, script):
    return subprocess.run(["docker", "exec", "-i", container, "bash"], input=script,
                          capture_output=True, text=True, check=True).stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("instance", nargs="?", help="EC2 instance id of the Wazuh manager (SSM)")
    ap.add_argument("--region", default="eu-west-1")
    ap.add_argument("--docker", metavar="CONTAINER", help="run in a local Wazuh manager container instead")
    a = ap.parse_args()
    if not a.instance and not a.docker:
        ap.error("give an instance id, or --docker CONTAINER")

    cases = [json.loads(l) for l in (HERE / "cases.jsonl").read_text().splitlines() if l.strip()]
    vectors = "\n".join(wrap(c) for c in cases) + "\n"
    packed = base64.b64encode(gzip.compress(vectors.encode())).decode()  # gzip keeps SSM's request small
    # Keep only the rule id/level of each event, plus any WARNING/ERROR line (e.g. a rule
    # dropped for an unknown if_sid). Descriptions are dropped to stay under SSM's 24k cap.
    script = (
        f"echo {packed} | base64 -d | gunzip > /tmp/vt-cases.txt\n"
        "/var/ossec/bin/wazuh-logtest < /tmp/vt-cases.txt 2>&1"
        " | grep -E \"^\\*\\*Phase 3|^\\s+(id|level): '|^[^[:space:]].*(WARNING|ERROR)\"\n"
        "rm -f /tmp/vt-cases.txt\n"
    )
    stdout = docker(a.docker, script) if a.docker else ssm(a.instance, a.region, script)

    for line in stdout.splitlines():
        if "WARNING" in line or "ERROR" in line:
            print(line, file=sys.stderr)

    # One "Phase 3" block per event, in order.
    got = []
    for b in stdout.split("**Phase 3")[1:]:
        m_id = re.search(r"id: '(\d+)'", b)
        m_lv = re.search(r"level: '(\d+)'", b)
        got.append((m_id.group(1) if m_id else "-", m_lv.group(1) if m_lv else "-"))

    if len(got) != len(cases):
        print(f"WARNING: {len(cases)} events sent, {len(got)} results parsed "
              f"(SSM output may be truncated at 24k chars)", file=sys.stderr)

    ok = fail = 0
    for c, g in zip(cases, got):
        if c["expect"] is None:
            continue
        good = g[0] == c["expect"]
        ok += good
        fail += not good
        print(f"{'ok  ' if good else 'FAIL'} {c['name'][:70]:<70} expect {c['expect']}  got {g[0]} L{g[1]}")
    print(f"\n{ok} passed, {fail} failed")
    sys.exit(1 if fail or len(got) != len(cases) else 0)


if __name__ == "__main__":
    main()
