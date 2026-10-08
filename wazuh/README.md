# VulnTrade — Wazuh Detection Pack

Reference Wazuh rules for VulnTrade's logs, plus a test harness that replays sample events through
`wazuh-logtest`. Load them into any Wazuh 4.x manager that reads VulnTrade's logs from S3 with the `aws-s3`
wodle (the `110xxx` rules, nested `aws.details.*` fields, no custom decoder). How the logs get to S3 is
described in [`../docs/log-shipping.md`](../docs/log-shipping.md).

The rules match the event names the backend emits (`login_failure`, `withdrawal_completed`, ...). When you
change event names in the backend, change the rules and `test-payloads/cases.jsonl` in the same commit.

The application side (event names, fields, the rule conventions) is specified in [`../docs/logging-guide.md`](../docs/logging-guide.md). The team sheet behind the event names is `../data/Security Events Baseline.xlsm`; the VulnTrade sheet is `../data/VulnTrade Security Events.xlsx`.

## How events reach the rules

```
Log4j2 JSON -> Fluent Bit -> S3 -> SQS -> aws-s3 wodle -> stock json decoder -> rule 80200
```

- The wodle wraps each line as `{"integration":"aws","aws":{...}}`, so rules see **`aws.<field>`** (`aws.eventType`, `aws.clientIp`) and **`aws.details.<key>`** (`aws.details.reason`).
- Every scalar arrives as a string: `"7"`, `"true"`, `"1E+7"`.
- Every VulnTrade line lands on `110090`; every `security.log` event on `110091`.

## Layout

```
wazuh/
├── rules/                        # loaded alphabetically, so the prefix sets the order
│   ├── vulntrade-00-base.xml       # 110090–110099  anchors + the rule conventions (read this first)
│   ├── vulntrade-10-auth.xml       # 110001–110049  logins, tokens, passwords, accounts, API keys, 401/403
│   ├── vulntrade-15-identity.xml   # 110050–110089  profile, uploads, sensitive data, isOwner=false
│   ├── vulntrade-20-injection.xml  # 110100–110159  content rules, SQLi, 400/500 fallbacks, debug endpoints
│   ├── vulntrade-25-framework.xml  # 110160–110179  actuator, H2 console, swagger, log tampering
│   ├── vulntrade-30-trading.xml    # 110300–110399  deposits, withdrawals, admin actions, orders, trades
│   └── vulntrade-40-websocket.xml  # 110400–110499  STOMP auth, admin topics/commands, close codes
├── test-payloads/
│   ├── cases.jsonl                 # one log record per line + the rule id it must land on
│   └── run-logtest.py              # replays cases.jsonl through wazuh-logtest (SSM or docker)
└── systemd/                        # host units for the S3 log shipper (not Wazuh rules)
```

On the manager every rule file goes flat into `/var/ossec/etc/rules/` (`rule_dir` is not recursive).

## Rule-id allocation

| Range | File | Group | Fed by |
|---|---|---|---|
| 110090–110099 | `vulntrade-00-base.xml` | `vulntrade` | every line (`110090`), every `security.log` event (`110091`) |
| 110001–110049 | `vulntrade-10-auth.xml` | `vulntrade_auth` | `login_*`, `logout`, `token_validation_failed`, `password_*`, `account_created`, `api_key_used`, `refresh_token_used`, `authorization_denied` |
| 110050–110089 | `vulntrade-15-identity.xml` | `vulntrade_identity` | `profile_updated`, `security_attribute_updated`, `permission_changed`, `file_created_or_uploaded`, `account_enabled/disabled`, `sensitive_data_*`, `data_exported` |
| 110100–110159 | `vulntrade-20-injection.xml` | `vulntrade_injection` | any field of either file (content rules), `app.log` SQL errors, `input_validation_failed`, `unexpected_exception`, `debug_*` |
| 110160–110179 | `vulntrade-25-framework.xml` | `vulntrade_framework` | `framework_endpoint_accessed`, `audit_configuration_changed` |
| 110300–110399 | `vulntrade-30-trading.xml` | `vulntrade_trading` | `deposit_completed`, `withdrawal_completed`, `admin_action`, `order_*`, `trade_executed` |
| 110400–110499 | `vulntrade-40-websocket.xml` | `vulntrade_websocket` | `websocket_*`, `admin_action` on the same STOMP session (`110441`) |

Each file's header comment lists its rule tree. Retired ids: `110004`, `110141`, `110142`. The stock `local_rules.xml` uses `100001`, which is why VulnTrade starts at `110000`.

## Levels

| Level | Meaning |
|---|---|
| 2 | Remembered for correlation, no alert (`order_created`, `trade_executed`) |
| 3 | Informational (login, logout, own profile update, expired token) |
| 5 | Low: a single failure or a notable action (password change, KYC update) |
| 6–8 | Medium: suspicious on its own (actuator, H2 console, large amounts, bursts of errors) |
| 10 | High: a strong attack indicator (brute force, SQLi, IDOR, wash trade) |
| 12 | Critical: exploitation (Log4Shell, alg:none, sign flip, mass assignment, admin channel bypass) |
| 13 | Confirmed compromise (account takeover, debug RCE, admin command that really ran) |

## Conventions (short version)

The full list is the comment at the top of `rules/vulntrade-00-base.xml` (and §6.2 of the logging guide).

1. Every `<field>`/`<regex>` uses `type="pcre2"`, with `(?i)` where case doesn't matter.
2. One base rule per `eventType` under `110091`; refinements (reason, path, isOwner, amount, action) are its children.
3. Bursts count the base rule; extra conditions go on a **child of the burst**. Wazuh remembers an event only under the rule it finally lands on. If a burst must also count the base rule's children, tag the base rule and the children with one `vt_*` group and count the group (`<if_sid>base</if_sid>` + `<if_matched_group>`), as the login bursts do with `vt_login_failure`. Never also point an `if_matched_sid` at a rule in that group.
4. Never level 0 below `110090`. Level 2 = remembered, no alert.
5. Neutral-name events (`password_changed`, `api_key_used`, ...) carry their result only in `aws.outcome`. A rule that means one result filters on `aws.outcome`; a rule that covers both shows `$(aws.outcome)` in its description.
6. Correlation keys: `aws.requestId` (one HTTP request), `aws.sessionId` (STOMP), `aws.clientIp` / `aws.username` / `aws.details.attemptedUsername` (bursts).
7. A rule may reference only ids in its own or an earlier file; parents go above children.
8. Booleans match `(?i)^(true|false)$`; amounts accept `e`/`E` and an optional `+` (`1E+7`, `1e+20`).

Descriptions start with `VulnTrade: `. A detection from the team sheet puts its sheet name next, e.g. `VulnTrade: brute_force_detected - 8 failed logins in 60s from 10.0.0.5`, so an analyst can map an alert to its sheet row.

## Testing the rules

`test-payloads/cases.jsonl` has one case per line:

```json
{"name": "...", "expect": "110002", "sink": "security", "log": { ...one security.log or app.log record... }}
```

`run-logtest.py` wraps each record the way the wodle does and feeds all of them to **one** `wazuh-logtest` session, in file order, so bursts and correlations see the events before them. It then compares the final rule id of each event with `expect`. Every rule has a positive case; every burst has an N-1 case that must **not** fire, followed by the Nth event that must. Each sequence uses its own IP, user, session and requestId, because an event that counted toward one burst window still counts for later cases.

**Locally, against a Wazuh manager container:**

```bash
docker run -d --name vt-wazuh wazuh/wazuh-manager:4.14.5
# wait ~1 minute for the manager to start
docker cp wazuh/rules/. vt-wazuh:/var/ossec/etc/rules/
./wazuh/test-payloads/run-logtest.py --docker vt-wazuh
```

Each logtest session loads the rule files fresh, so after editing a rule just `docker cp` again and re-run.

**Against a Wazuh manager on EC2, over SSM** (needs AWS credentials that can run SSM commands on that instance):

```bash
./wazuh/test-payloads/run-logtest.py <instance-id> [--region eu-west-1]
```

Output is one `ok`/`FAIL` line per case and a summary; the exit code is non-zero on any failure. `WARNING`/`ERROR` lines from `wazuh-logtest` (for example a rule dropped because of an unknown `if_sid`) are printed to stderr and must be fixed: a run is only green with **no** warnings.

## Editing rules

1. Find the event in the logging guide and the right file in the table above. Pick a free id in that file's range.
2. Add the rule under its base rule (convention 2). For a burst, add the burst and put extra conditions on a child of it (convention 3).
3. Add cases to `cases.jsonl`: a positive case, and for a burst an N-1 case plus the Nth event, all with their own IP/user/session.
4. Run `run-logtest.py --docker vt-wazuh`: every case passes, no warnings.
5. Commit the rule and its cases together.
