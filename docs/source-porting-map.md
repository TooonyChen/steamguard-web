# Source Porting Map

This map points from planned TypeScript implementation areas to the Rust source that should be used as the primary reference.

License rule:

- `steamguard-cli/steamguard-cli/steamguard/` is the MIT/Apache library area. Porting logic from here is acceptable.
- `steamguard-cli/steamguard-cli/src/` is the GPLv3 CLI area. Use it as behavioral reference only unless this Web project is intentionally relicensed as GPLv3.

## Direct TypeScript Ports From `steamguard/`

| Feature | Rust source | Reuse | TS target |
| --- | --- | --- | --- |
| Full `.maFile` account shape | `steamguard/src/lib.rs:35-52` | Port struct fields and JSON shape | `src/steam/account.ts` |
| Account JSON parse/export behavior | `steamguard/src/lib.rs:77-87` | Port behavior | `src/steam/mafile.ts` |
| Steam Guard code generation | `steamguard/src/token.rs:27-61`, `steamguard/src/token.rs:100-102` | Port algorithm directly | `src/steam/guard-code.ts` |
| Token and JWT model | `steamguard/src/token.rs:104-186` | Port data shape and JWT decode | `src/steam/tokens.ts` |
| Steam server time helper | `steamguard/src/steamapi.rs:17-28`, `steamguard/src/steamapi/twofactor.rs:124-129` | Port endpoint usage | `src/steam/time.ts` |
| Generic Steam WebAPI request format | `steamguard/src/steamapi.rs:30-80`, `steamguard/src/transport/webapi.rs:24-60`, `steamguard/src/transport/webapi.rs:96-130` | Port request construction and protobuf encoding rules | `src/steam/webapi-transport.ts` |
| `EResult` mapping | `steamguard/src/steamapi.rs:107-170` and rest of enum | Port needed enum values first | `src/steam/eresult.ts` |
| Authentication API methods | `steamguard/src/steamapi/authentication.rs:31-211` | Port endpoints and auth requirements | `src/steam/authentication-client.ts` |
| TwoFactor API methods | `steamguard/src/steamapi/twofactor.rs:27-130` | Port endpoints and auth requirements | `src/steam/twofactor-client.ts` |
| Access token refresh | `steamguard/src/refresher.rs:23-42` | Port flow | `src/steam/token-refresh.ts` |
| Steam credential login start | `steamguard/src/userlogin.rs:116-156` | Port request fields and response handling | `src/steam/login-flow.ts` |
| QR auth session start | `steamguard/src/userlogin.rs:158-186` | Port request fields | `src/steam/login-flow.ts` |
| Auth session polling | `steamguard/src/userlogin.rs:188-252` | Convert loop into web poll state machine | `src/steam/login-flow.ts` |
| Submit Steam Guard/email code | `steamguard/src/userlogin.rs:255-291` | Port request behavior | `src/steam/login-flow.ts` |
| Steam password RSA encryption | `steamguard/src/userlogin.rs:295-310` | Port behavior using `node-forge` | `src/steam/crypto/rsa-password.ts` |
| Device details shape | `steamguard/src/userlogin.rs:361-384` | Port constants and fields | `src/steam/device-details.ts` |
| Add authenticator | `steamguard/src/accountlinker.rs:45-97` | Port API flow and account construction | `src/steam/authenticator-setup.ts` |
| Finalize authenticator | `steamguard/src/accountlinker.rs:99-134` | Port flow and `want_more` handling | `src/steam/authenticator-setup.ts` |
| Query authenticator status | `steamguard/src/accountlinker.rs:136-146` | Port endpoint usage | `src/steam/authenticator-status.ts` |
| Remove authenticator | `steamguard/src/accountlinker.rs:148-176` | Port endpoint behavior | `src/steam/authenticator-remove.ts` |
| Transfer authenticator start/finish | `steamguard/src/accountlinker.rs:178-237` | Port flow and replacement token mapping | `src/steam/authenticator-transfer.ts` |
| Account link result and confirm type | `steamguard/src/accountlinker.rs:240-286` | Port enum/data model | `src/steam/authenticator-setup.ts` |
| Device ID generation | `steamguard/src/accountlinker.rs:288-290` | Port `android:<uuid>` format | `src/steam/device-id.ts` |
| Confirmation query params and cookies | `steamguard/src/confirmation.rs:41-82` | Port query/cookie construction | `src/steam/confirmations.ts` |
| Confirmation list | `steamguard/src/confirmation.rs:85-119` | Port endpoint and response handling | `src/steam/confirmations.ts` |
| Single confirmation action | `steamguard/src/confirmation.rs:121-179` | Port endpoint and response handling | `src/steam/confirmations.ts` |
| Bulk confirmation action | `steamguard/src/confirmation.rs:195-324` | Port endpoint and body format | `src/steam/confirmations.ts` |
| Confirmation details | `steamguard/src/confirmation.rs:327-364` | Port endpoint | `src/steam/confirmations.ts` |
| Confirmation data types | `steamguard/src/confirmation.rs:398-490` | Port response types | `src/steam/confirmations.ts` |
| Confirmation hash | `steamguard/src/confirmation.rs:493-510` | Port HMAC-SHA1 algorithm | `src/steam/confirmation-hash.ts` |
| Login session list/info | `steamguard/src/approver.rs:43-74` | Port endpoint flow | `src/steam/login-approvals.ts` |
| Login approve/deny API | `steamguard/src/approver.rs:76-145` | Port request behavior | `src/steam/login-approvals.ts` |
| Login approval signature | `steamguard/src/approver.rs:147-158` | Port HMAC-SHA256 algorithm | `src/steam/login-approval-signature.ts` |
| Steam QR challenge URL parsing | `steamguard/src/approver.rs:160-175` | Port parser | `src/steam/qr-login.ts` |

## CLI Flow References Only

Do not copy these files directly unless the project license decision changes.

| Web feature | GPL CLI source | How to use |
| --- | --- | --- |
| Setup authenticator web state machine | `src/commands/setup.rs:29-156`, `src/commands/setup.rs:170-260` | Use as flow reference only; implement state machine in `auth_flows` |
| Transfer authenticator web state machine | `src/commands/setup.rs:263-307` | Use as flow reference only |
| maFile import UX and external fallback idea | `src/commands/import.rs:18-70` | Reference behavior; implement new validation and encrypted storage |
| Code command behavior | `src/commands/code.rs:33-49` | Reference server-time fallback behavior |
| Confirmation retry behavior | `src/commands/confirm.rs:39-150` | Reference retries; avoid blocking sleeps in Worker |
| Login approval UI fields | `src/commands/approve.rs:42-170` | Reference displayed fields and actions |
| QR login CLI flow and image scan | `src/commands/qr_login.rs:22-79`, `src/commands/qr_login.rs:107-130` | Reference only; frontend image scan can use a JS QR library later |
| Manifest format | `src/accountmanager/manifest.rs:9-23` | Reference only for compatibility import/export, not storage design |
| CLI maFile encryption | `src/encryption/argon2id_aes.rs:23-110` | Do not copy for Web vault; use AES-GCM design instead |

## Test Vectors To Reuse

| Test area | Rust source | Use |
| --- | --- | --- |
| Steam Guard code generation | `steamguard/src/token.rs:188-260` | Port expected code fixtures |
| JWT decode examples | `steamguard/src/token.rs:262-303` | Port decode tests |
| Confirmation parse/hash | `steamguard/src/confirmation.rs:513-579` | Port confirmation parse and hash tests |
| Login approval challenge parse/signature | `steamguard/src/approver.rs:230-284` | Port parser and HMAC signature tests |
| RSA password encryption behavior | `steamguard/src/userlogin.rs:482-501` | Use as structural reference; ciphertext is randomized outside test RNG |
| Protobuf transport roundtrip | `steamguard/src/transport/webapi.rs:133-186` | Port encode/decode roundtrip fixtures |
