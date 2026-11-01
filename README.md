# Orbit for Chrome

> **Experimental prototype.** Browser and model compatibility varies. Read [TESTING.md](TESTING.md) for verified checks and remaining manual validation.

An installable Chrome Manifest V3 extension that puts your own AI model beside your browser. No build step, Orbit account, backend, or subscription to this extension is required. You supply an API endpoint, model ID, and your own credentials.

## Install in Chrome

1. Extract `orbit-chrome-extension.zip` into a permanent folder.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and select the extracted **`orbit-chrome/extension`** folder — the folder containing `manifest.json`.
4. Pin Orbit from Chrome's Extensions menu and click its icon to open the side panel.
5. Open **Connections** using the settings icon. Choose your provider and paste your API key.
6. Click **Find models**, then choose a text/chat model in **Model ID**, or type the exact ID your provider gives you. Optionally use **Test connection**, then click **Save connection**.
7. Open a regular website and send a request. Leave the page checkbox selected to attach page context. Orbit will ask for site access when needed.

Chrome must be version 116 or later. This package is for local unpacked installation; it has not been published to the Chrome Web Store. Keep its folder in place after installation. To update edited files, click Reload for Orbit at `chrome://extensions` and reopen its side panel. Session credentials are cleared on extension reload.

## Things you can ask

- “Summarize this page and tell me what I should pay attention to.”
- “Rewrite this draft to sound clearer, and put the new version in the message field.”
- “Fill this form with these details: …”
- “Open example.com in a new tab and summarize its homepage.”
- “Find my open tab about the conference and show me the registration deadline.”
- “Draft a message to this recipient, then send it after I review the final click.”

**Ask** reads pages and answers questions. **Assist** can also propose changes. Every click, field edit, dropdown change, scroll, tab opening, navigation, tab switch, and tab closure gets a separate review. Clicking a website's Send/Submit button is how Orbit sends information; there is no direct email API integration. Some sites reject synthetic clicks or use editors this extension cannot control.

The approval preview includes the exact proposed value, target, URL and available form/context details. Review the website itself as well, especially recipients and final content. Approvals expire after two minutes and can run only once. If a tab navigates or an observed target/form changes, the approval is rejected. **Decline** ends that task. **Stop** cancels further model/tool steps; changes already made stay in place. Closing the side panel stops the in-progress agent loop. Tasks do not resume automatically.

## Model compatibility

“Every model in the world” cannot be promised: some models have no API, use a proprietary protocol, require cloud signing/OAuth, or produce only images, audio, embeddings, or classifications. Orbit supports **text/chat models accessible through the five API formats below**, including reasoning models that return visible text. Browser automation also requires the model to follow simple JSON instructions reliably. Models that return ordinary prose can still answer in chat, but will not perform browser actions from that prose.

| API format | Typical providers | Default generation path |
| --- | --- | --- |
| OpenAI Responses | OpenAI and compatible servers | `responses` |
| OpenAI Chat Completions | OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Cerebras, LM Studio, and compatible servers | `chat/completions` |
| Anthropic Messages | Direct Claude API and compatible gateways | `messages` |
| Google Gemini | Gemini Developer API and compatible gateways | `models/{model}:generateContent` |
| Ollama native | Local Ollama | `api/chat` |

Presets fill the API root and format. Model IDs are not hardcoded: use the live catalog or enter one manually. A provider catalog can list unsupported non-chat models as well, so choose a model with text conversation capabilities. Actual availability depends on your provider/account. Other APIs need an adapter or a compatible gateway. This version does not support native image/audio/video workflows or all of a provider's specialized features.

Multiple saved connections let you switch providers and models. Credentials stay scoped to each connection. Model discovery uses `/models` for compatible servers, paginated Gemini/Anthropic catalogs, and `/api/tags` for Ollama. If the endpoint doesn't offer discovery, enter the model manually. Up to twelve catalog pages are fetched per discovery request.

### Custom providers and advanced settings

Set **API format**, **API base URL**, and **Model ID**. The API base must include the provider's root path, such as `/v1`. A **Custom request path** replaces the default generation path and is appended to that root; it can include query parameters. Requests always stay on the configured API origin. Authentication can use automatic provider headers, Bearer, `api-key`, `x-api-key`, or no authentication. Custom headers are a JSON object of string values.

For an Azure Chat Completions deployment, for example, set the base to `https://YOUR-RESOURCE.openai.azure.com`, choose Chat Completions, use the `api-key` authentication header, enter your deployment name as Model ID, and use the deployment request path and API version specified by your Azure endpoint. Discovery may be unavailable; enter the ID manually. Not all Azure API variants use the same path or protocol.

**Request options** are a JSON object for model-specific settings. Examples depend on the chosen API:

```json
{"max_tokens": 8192}
```

```json
{"max_output_tokens": 8192, "reasoning": {"effort": "low"}}
```

```json
{"generationConfig": {"maxOutputTokens": 8192}}
```

Only use options the selected model/API accepts. Conversation, model, system, stream and tool fields cannot be overridden. Orbit uses non-streaming text responses, so the panel displays a working status until the model finishes. A request times out after two minutes. Anthropic defaults to 4,096 `max_tokens`; Responses defaults to 4,096 `max_output_tokens`. Chat Completions leaves token/temperature options unspecified for wider compatibility. Reasoning models may need a larger output budget.

### Local models

With Ollama running, choose **Ollama · local**, leave the key empty unless your server requires one, and use Find models to select an installed model. Default root: `http://localhost:11434`. For LM Studio, start its local OpenAI-compatible server, choose **LM Studio · local**, and use `http://localhost:1234/v1`. Orbit does not install/download models or start either server.

If a local server rejects the extension origin, follow that server's documentation to allow your specific `chrome-extension://EXTENSION_ID` origin. Find the ID on Chrome's Extensions page. Avoid granting origins more broadly than needed. Chrome may also require you to approve access to the local network. Remote endpoints must use HTTPS; plain HTTP endpoints are accepted only on `localhost`, `127.0.0.1`, or `[::1]`.

## Privacy and permissions

- **Direct connection:** API requests go from the extension page to the configured provider. There is no Orbit server, analytics, or remote JavaScript. Your provider receives the selected conversation context, page observations, and task results needed for the request. Its own retention/billing policies apply. Testing a connection sends a short model message and may use API credits.
- **Credentials:** keys and custom headers are in `chrome.storage.session` by default, and are lost on browser restart or extension reload. “Remember credentials on this device” opts into `chrome.storage.local`, which is **not encrypted**. They are never stored in Chrome Sync or sent to page content scripts. Both storage areas are restricted to trusted extension contexts. Error messages redact configured credentials. Do not embed shared production keys into this source code.
- **Page access:** hosts are optional and granted per site through Chrome. Granting a provider host allows network calls; granting a website host allows its top-level page to be inspected/controlled. Existing site permissions persist until you revoke them in Chrome. The page checkbox controls automatic attachment; when it is off, the assistant can still request page tools if needed for your task. To keep a conversation entirely away from pages, use prompts that do not ask for browser work and leave attachment off.
- **Browser permissions:** `tabs` is used for tab titles/URLs and management; `scripting` injects the packaged page controller; `sidePanel` shows the UI; `storage` saves connections and session state; `activeTab` supports user-initiated extension use. No debugger, cookie, history, filesystem, clipboard, microphone or camera API is requested.
- **Page redaction:** standard password, file, known payment/credential fields and explicitly private-marked content are excluded or redacted. Redaction is heuristic and cannot recognize all sensitive information in ordinary visible text. Attaching a page can disclose its visible content to your selected provider. Do not attach pages whose content you do not want that provider to receive.
- **Session history:** conversation and a limited activity log are kept in browser-session memory (60 message entries and 80 activity entries per window). Page snapshots are not saved as chat history. Draft text can appear in activity and conversation entries. New conversation or Clear chat and activity removes this panel's session log. Deleting a connection clears its credentials from both stores. To revoke host permissions or remove all data, use Chrome's extension controls or uninstall Orbit.
- **Untrusted pages:** the agent prompt explicitly treats page content as untrusted, the controller exposes a fixed set of tools, and user approval is required for each mutation. These measures reduce risk; they do not make an LLM immune to prompt injection or make an untrusted website trustworthy. Review actions involving private data or external communication.

## Supported page controls and limits

Orbit reads rendered text, selected text, standard form fields, links and buttons. It can edit ordinary inputs, textareas, single-select dropdowns and basic contenteditable elements. Open shadow roots are inspected. Viewport elements are prioritized, and scrolling can expose more targets.

Chrome blocks extension control of browser-internal pages, the Chrome Web Store, and other extensions. This version also does not automate file pages, cross-origin/nested frames, closed shadow roots, canvas-only applications, CAPTCHAs, file pickers, native permission/login dialogs, or protected browser UI. Google Docs and other canvas or highly customized rich editors may need manual work or a dedicated integration. Some applications require trusted hardware input and reject synthetic events. Input/change events can trigger website autosaving or other site-defined behavior; they are therefore reviewed actions too. Normal page loads may open native dialogs the extension cannot handle. Large page content, models with small context windows, and insufficient token budgets can cause API failures.

## Practice page

From the extracted `orbit-chrome` folder, run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000/tests/fixture.html` in Chrome. This practice form does not send data to a server. Ask Orbit to fill the recipient and message and send it. Approve the field edits, then review the final Send click. It also has a test password field that must be redacted. Stop the local server with Ctrl+C when finished.

## Development and verification

The running extension uses plain JavaScript/CSS and has no runtime package dependencies.

```sh
npm test
npm run check
npm run package
```

`npm test` uses Node's built-in test runner. `npm run check` checks the manifest, local resources, DOM bindings, module imports, PNG icons and JavaScript syntax. Packaging produces `../orbit-chrome-extension.zip`.

For the optional real-browser integration test (with a local fake provider, no API key):

```sh
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
```

The browser suite creates a temporary test-only copy that pre-grants loopback access, then checks connection setup, read/fill/approve/send/verify, redaction, declined edits and stale observations. It never changes the production manifest. Chrome's native host-permission prompts must be checked manually with the production extension. See `TESTING.md` for the validation status and release checklist.

### Structure

```text
extension/
  manifest.json       Chrome MV3 package; load this directory
  sidepanel.html      Assistant, settings and approval UI
  styles.css          Local responsive UI styles
  sidepanel.js        Chat, provider setup and run lifecycle
  background.js       Browser-tool broker and one-use approval tokens
  content.js          Isolated-world page reader/controller
  lib/
    config.js         Endpoint/profile validation and URL rules
    providers.js      Five API formats and model discovery
    agent.js          Bounded model/action loop
    storage.js        Profile and credential persistence
    tools.js          Tool names, validation and preview titles
tests/                Unit, broker, credential and optional browser tests
scripts/              Validation and ZIP packaging
```

## Official API references

- [Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [Permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions), [Scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [Storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [OpenAI text generation](https://developers.openai.com/api/docs/guides/text)
- [Anthropic API overview](https://platform.claude.com/docs/en/api/overview)
- [Gemini generateContent](https://ai.google.dev/api/generate-content), [model discovery](https://ai.google.dev/api/models)
- [Ollama chat API](https://docs.ollama.com/api/chat)

MIT licensed. This is an independent extension, not an official product of Chrome, Google, OpenAI, Anthropic, or the listed model providers.
