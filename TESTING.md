# Validation status

Prepared 1 November 2026.

## Executed successfully

- `npm test`: **40 tests passed, 0 failed** (Node 24).
- `npm run check`: manifest/resource checks, JavaScript syntax, local module imports, HTML DOM bindings, PNG icon signatures, and checks excluding remote scripts and arbitrary code evaluation.
- `node --check tests/browser-smoke.mjs`: optional real-browser suite syntax.
- ZIP integrity test and presence of the loadable extension manifest (performed by the packaging script).

The automated suite uses mocked Chrome APIs and provider responses. It covers all five request/response adapters; HTTP security options; custom authentication; credential error redaction; native model catalog formats/pagination; JSON action validation; read-only mode; bounded runs; interruption; declined actions; same-window tab scope; website-origin permission checks; read-versus-write tool enforcement; previews without effects; one-use approvals under simultaneous replay; changed tab URLs; expired approvals; panel ownership; session-only keys; opt-in local key storage; and deletion of credentials.

## Not executed in this environment

- The optional **real Chromium browser smoke test**: a runnable Chromium binary was unavailable. The included suite still needs execution on a machine with Chromium/Playwright.
- **Live model/provider calls**: no real API key was supplied. Provider adapters were validated with mock responses, not real account credentials. Preset endpoint availability, account entitlements, model-specific parameters, and third-party site compatibility need real-environment verification.
- Chrome Web Store review/publication. This deliverable is for unpacked installation.

## Manual Chrome release checks

1. Load the production `extension/` directory in Chrome 116+; verify no manifest/service-worker errors in the Extensions page.
2. Open Orbit from its pinned icon, navigate between tabs, and verify the panel remains usable.
3. Save a connection, discover or enter a real text/chat model, test it, and send an ordinary chat request with page context off.
4. Attach the practice page; verify a native host-permission request occurs on first access and denial stops the task.
5. Run the practice fill/send task. Confirm each edit and final click gets a preview; verify recipients and message are visible in the final review and the password value is not sent to the provider.
6. Decline an action; verify the form stays unchanged for that action. Change a field after a preview appears, approve the old preview, and verify it is rejected.
7. Stop a slow model call and close/reopen the panel; verify no unapproved actions run. Previously completed changes should remain.
8. Restart Chrome with session-only credentials; verify the key must be entered again. Repeat with Remember enabled, then disable it and confirm the persistent copy is removed.
9. Try each provider/API format you plan to use, including model-specific token settings and any native server origin configuration for local models.
10. Try your intended real websites. Custom editors, frames, trusted-input requirements and website redesigns can require dedicated adapters or manual work.
