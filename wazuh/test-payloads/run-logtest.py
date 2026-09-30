#!/usr/bin/env python3
"""Replay cases.jsonl through wazuh-logtest on a Wazuh manager over SSM and assert rule ids.

Each case is a raw VulnTrade log record. It is wrapped exactly as the aws-s3 wodle
emits it after Fluent Bit parsing ({"integration":"aws","aws":{...}}, scalars
stringified), so the test exercises the real decode path, not the app's raw schema.

All cases run in ONE logtest session, in file order, so frequency / correlation
rules see their preceding events. Cases with "expect": null only feed a sequence.

Usage (needs AWS creds for the manager's account in the environment):
  ./run-logtest.py <instance-id> [--region eu-west-1]
"""
import argparse, base64, json, pathlib, re, subprocess, sys, time

HERE = pathlib.Path(__file__).parent


def stringify(v):
    if isinstance(v, dict):
        return {k: stringify(x) for k, x in v.items()}
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


def ssm(instance, region, script, comment):
    b64 = base64.b64encode(script.encode()).decode()
    params = json.dumps({"commands": [f"echo {b64} | base64 -d | bash"]})
    cid = subprocess.check_output(
        ["aws", "ssm", "send-command", "--region", region, "--instance-ids", instance,
         "--document-name", "AWS-RunShellScript", "--comment", comment,
         "--parameters", params, "--query", "Command.CommandId", "--output", "text"], text=True).strip()
    while True:
        time.sleep(4)
        out = json.loads(subprocess.check_output(
            ["aws", "ssm", "get-command-invocation", "--region", region, "--instance-id", instance,
             "--command-id", cid, "--output", "json"], text=True))
        if out["Status"] not in ("Pending", "InProgress", "Delayed"):
            return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("instance")
    ap.add_argument("--region", default="eu-west-1")
    a = ap.parse_args()

    cases = [json.loads(l) for l in (HERE / "cases.jsonl").read_text().splitlines() if l.strip()]
    vectors = "\n".join(wrap(c) for c in cases) + "\n"
    script = (
        f"echo {base64.b64encode(vectors.encode()).decode()} | base64 -d > /tmp/vt-cases.txt\n"
        "/var/ossec/bin/wazuh-logtest < /tmp/vt-cases.txt 2>&1 | grep -E \"^\\*\\*Phase 3|^\\s+id: '|^\\s+level: '|^\\s+description: '\"\n"
        "rm -f /tmp/vt-cases.txt\n"
    )
    out = ssm(a.instance, a.region, script, "vulntrade rules logtest (read-only)")
    stdout = out["StandardOutputContent"]

    # One "Phase 3" block per event, in order.
    blocks = stdout.split("**Phase 3")[1:]
    got = []
    for b in blocks:
        m_id = re.search(r"id: '(\d+)'", b)
        m_lv = re.search(r"level: '(\d+)'", b)
        m_d = re.search(r"description: '(.*)'", b)
        got.append((m_id.group(1) if m_id else "-", m_lv.group(1) if m_lv else "-", m_d.group(1) if m_d else ""))

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
        mark = "ok  " if good else "FAIL"
        print(f"{mark} {c['name']:<42} expect {c['expect']}  got {g[0]} L{g[1]}  {g[2][:90]}")
    print(f"\n{ok} passed, {fail} failed")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
