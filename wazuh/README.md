# VulnTrade — Wazuh Detection Pack (temporary home)

> **SYNCED WITH THE DEPLOYED CLUSTER (2026-09-30).** `rules/` and `test-payloads/` here now
> **mirror the working deployed ruleset** at
> `infrastructure-security/wazuh/configs/rules/applications/vulntrade/` — the `110xxx`,
> nested-`aws.details.*` scheme the AWS dev cluster actually loads (fed by the `aws-s3` wodle, no
> custom decoder). The old flat `100xxx` rule files and the custom decoder have been **retired**
> (`decoders/vulntrade-decoder.xml` is now a tombstone). Author changes in the infrastructure-security
> copy first, then re-mirror here. The rule-id-scheme notes below are historical.

> **This directory is a parking lot.** The Wazuh decoder, rules, and test payloads here are destined to move to a separate Wazuh-focused repository. VulnTrade itself should only ever own *application logging* and the path to S3 (see [`../docs/log-shipping.md`](../docs/log-shipping.md)). Keep these artifacts here only as long as it's convenient to co-edit them with the log schema; promote them out once the schema stabilizes.

Detection content for VulnTrade's backend logs. The application side is specified in [`../docs/logging-guide.md`](../docs/logging-guide.md); the S3 shipping contract (which any SIEM consumes) is in [`../docs/log-shipping.md`](../docs/log-shipping.md). This README is the map of what's in this directory and the rule-id scheme.

## Layout

```
wazuh/
├── decoders/
│   └── vulntrade-decoder.xml          # JSON decoder + auxiliary field extraction
├── rules/
│   ├── vulntrade-auth.xml             # 100000–100099
│   ├── vulntrade-injection.xml        # 100100–100199
│   ├── vulntrade-authz.xml            # 100200–100299
│   ├── vulntrade-trading.xml          # 100300–100399
│   └── vulntrade-websocket.xml        # 100400–100499
└── test-payloads/
    ├── auth/…json                     # canned log lines for wazuh-logtest
    ├── injection/…json
    ├── authz/…json
    ├── trading/…json
    ├── websocket/…json
    └── run-logtest.sh                 # replays payloads and asserts rule ids
```

> `wazuh/agent/` and `wazuh/local-stack/` used to live here (agent-sidecar shipping). That model has been replaced by S3 log delivery — see [`../docs/log-shipping.md`](../docs/log-shipping.md). When you promote this directory to its own repo, drop the Wazuh manager's `aws-s3` / `aws-sqs` wodle config there instead of an agent sidecar config.

## Rule-id allocation

| Range | Group | File | Notes |
|---|---|---|---|
| 100000–100099 | `vulntrade_auth` | `vulntrade-auth.xml` | login, JWT, password, reset |
| 100100–100199 | `vulntrade_injection` | `vulntrade-injection.xml` | SQLi, Log4Shell, XSS, log-injection patterns (content-based) |
| 100200–100299 | `vulntrade_authz` | `vulntrade-authz.xml` | role checks, IDOR probing, admin access |
| 100300–100399 | `vulntrade_trading` | `vulntrade-trading.xml` | orders, deposits, withdrawals, admin economic actions |
| 100400–100499 | `vulntrade_websocket` | `vulntrade-websocket.xml` | STOMP CONNECT/SUBSCRIBE/SEND/rate anomalies |

## Levels (Wazuh severity convention)

| Level | Meaning |
|---|---|
| 3 | Informational security event (successful login, normal admin action) |
| 5 | Low — single failure, one-off anomaly |
| 8 | Medium — repeated failure, suspicious content match |
| 10 | High — strong attack indicator (Log4Shell string, JWT `alg:none`) |
| 12 | Critical — confirmed compromise signal (RCE output, admin-by-non-admin) |

## Design principles

1. **Match on `eventType`, not regex against `message`.** The canonical schema exists for a reason — rules that pattern-match on `message` substrings break the moment a developer rephrases the log line.
2. **Two sinks, two rulesets.** `app.log` is the raw sink — use it for content-match detection (Log4Shell `${jndi:`, SQL tautologies, XSS payloads). `security.log` is the sanitized sink — use it for event-shape detection (auth failures, authz denials, unusual rates). Scope each rule with `<field name="log_source">vulntrade-app</field>` or `vulntrade-security`.
3. **Frequency rules beat single-shot rules** for probing behavior. IDOR, credential stuffing, subscription sweeps all look innocuous per-event; they're attacks at volume.
4. **False-positive budget is real.** Every rule should have a sample "should not match" payload in `test-payloads/` so we know what the boundary looks like.
5. **Mirror the taxonomy back to PoCs.** Every exploit script under `tools/exploits/` (PR-2) names the rule id it expects to fire, so detection gaps are visible in the run_all.py matrix.

## Editing rules

When adding or modifying a rule:

1. Pick a free id in the appropriate range.
2. Add a matching sample payload under `test-payloads/<group>/<rule-id>.json`.
3. Add a negative sample (same event type, safe content) under `test-payloads/<group>/<rule-id>.noop.json`.
4. Run `./test-payloads/run-logtest.sh` — both samples must behave as expected.
5. Commit the rule + both payloads together.
