#!/usr/bin/env python3
"""
Summarize one benchmark suite (the folders test/bench/suite.sh writes) into one JSON file.

    python3 test/bench/summarize.py <results-dir> > summary.json

For every run folder (mixed-1, stress-50, iso-eq_mkt, ...) it reads Locust's CSVs and the pod
snapshots, and reports per operation: requests, ok/s, failures, business rejects, p50/p95/p99,
plus pod CPU/memory after the run and whether the money invariants held.
"""
import csv
import json
import os
import re
import sys

SETUP = "setup:"


def ops(run_dir):
    path = os.path.join(run_dir, "locust_stats.csv")
    if not os.path.exists(path):
        return {}
    out = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            name = row["Name"]
            if name == "Aggregated" or name.startswith(SETUP):
                continue
            out[name] = {
                "requests": int(row["Request Count"]),
                "failures": int(row["Failure Count"]),
                "rps": float(row["Requests/s"]),
                "p50": float(row["50%"] or 0), "p95": float(row["95%"] or 0), "p99": float(row["99%"] or 0),
                "max": float(row["Max Response Time"] or 0), "avg": float(row["Average Response Time"] or 0),
            }
    # fold "[rejected]" lines into their operation as business rejects
    for name in [n for n in out if n.endswith(" [rejected]")]:
        base = name[:-len(" [rejected]")]
        out.setdefault(base, {"requests": 0, "failures": 0, "rps": 0, "p50": 0, "p95": 0, "p99": 0, "max": 0, "avg": 0})
        out[base]["rejects"] = out[name]["requests"]
        del out[name]
    return out


def pods(run_dir):
    """CPU (millicores) and memory (MiB) per pod from the 'after' kubectl top snapshot."""
    path = os.path.join(run_dir, "environment.txt")
    if not os.path.exists(path):
        return {}
    text = open(path).read()
    after = text.split("## after", 1)[-1]
    out = {}
    for m in re.finditer(r"^(\S+)-[a-z0-9]+-[a-z0-9]+\s+(\d+)m\s+(\d+)Mi", after, re.M):
        out[m.group(1)] = {"cpu_m": int(m.group(2)), "mem_mi": int(m.group(3))}
    for m in re.finditer(r"^(postgres-0)\s+(\d+)m\s+(\d+)Mi", after, re.M):
        out["postgres"] = {"cpu_m": int(m.group(2)), "mem_mi": int(m.group(3))}
    restarts = sum(int(m.group(1)) for m in re.finditer(r"^\S+\s+(\d+)$", after, re.M))
    load = re.findall(r"load average: ([\d.]+)", text)
    thinkpad = re.findall(r"thinkpad-poc cpu=([\d.]+)%", text)
    return {"pods": out, "restarts": restarts, "host_load_1m": [float(x) for x in load],
            "thinkpad_cpu_pct": [float(x) for x in thinkpad]}


def invariants(run_dir):
    path = os.path.join(run_dir, "invariants.txt")
    return os.path.exists(path) and "ALL INVARIANTS HOLD" in open(path).read()


def main():
    root = sys.argv[1]
    runs = {}
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if os.path.isdir(d) and name != "warmup":
            runs[name] = {"ops": ops(d), "resources": pods(d), "invariants_hold": invariants(d)}
    json.dump({"source": root, "runs": runs}, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
