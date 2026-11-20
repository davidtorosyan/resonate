# The assistant connector: one tool list, for good (A6)

**Problem (the owner, v88):** the new tools (`get_score_view`, `get_score_xml`, `get_score_pdf`, the `score_*` actions) never showed up in ChatGPT. Uninstalling, reinstalling and re-authorizing didn't help. Only deleting the custom connector and adding it again worked.

**Decision:** the MCP server's tool list is frozen. These 15 tools keep their names, input schemas and annotations for good. Each new ability becomes an entry in `supabase/functions/mcp/catalog.ts`: an action of `control_resonate` or a query of `read_resonate`. `get_capabilities` lists the entries live. Clients copy the tool list, but tool answers always come from the live server, so new abilities reach every assistant through the answers. The owner re-adds the connector one last time, or uses Refresh in ChatGPT.

## What the clients do (researched 2026-11-20)

### ChatGPT

- **It stores a snapshot.** Tool names, descriptions, schemas, annotations and the server `instructions` are read when the custom MCP server is added. They are read again only when you press **Refresh** on the plugin's detail page at chatgpt.com/plugins.
  - [Developer mode guide](https://developers.openai.com/api/docs/guides/developer-mode): "refresh apps to pull new tools, descriptions, and server instructions from the MCP server".
  - [Connect and test → Refresh metadata](https://developers.openai.com/plugins/deploy/connect-chatgpt): deploy, open the connection at chatgpt.com/plugins, select Refresh, then start a new conversation.
  - [Build an MCP server → Plan for updates](https://developers.openai.com/plugins/build/mcp-server): "Keep published tool names and schemas backward compatible… If metadata changes, refresh the custom MCP server connection".
- **OpenAI support has confirmed it.** On 2026-09-29 they wrote that tool definitions are "stored as a frozen snapshot after approval" and that an admin refreshes them ([forum](https://community.openai.com/t/custom-mcp-connector-oauth-token-never-forwarded-401s-dont-trigger-re-auth-and-the-tool-list-is-frozen-per-publish/1400778)).
- **Refresh is hard to find.**
  - There is no API for it ([feature request, 2026-09](https://community.openai.com/t/feature-request-public-api-for-refreshing-a-developer-mcp-apps-actions-in-chatgpt/1395374)).
  - Its place in the UI has moved. On Business plans, published apps once had no Refresh at all ("delete and recreate"; [forum, 2026-02](https://community.openai.com/t/incorrect-ui-path-in-apps-sdk-docs-connect-chatgpt-refreshing-metadata/1372893)).
  - The help center says Refresh pulls new actions "deselected by default" ([help article 12584461](https://help.openai.com/en/articles/12584461)). We only saw this in a search excerpt: the page refuses scripted fetches. So a refreshed connector can still hide new tools until each one is switched on.
- **Why the owner's attempts failed (inferred).**
  - The snapshot belongs to the connection.
  - Uninstalling and reinstalling the plugin brings back the same connection.
  - Re-authorizing reuses the same OAuth client ([troubleshooting](https://developers.openai.com/plugins/deploy/troubleshooting): "ChatGPT reuses these credentials"), and OAuth never re-reads tools.
  - Only Refresh or a new connection reads `tools/list` again.
- **`notifications/tools/list_changed` doesn't help.** Nothing documents it, and no report shows ChatGPT acting on it. Published directory plugins are different: OpenAI rescans them periodically ([continuous review](https://developers.openai.com/plugins/deploy/app-review)), but that doesn't apply to a custom connector.
- **Tool calls always reach the live server.** Only the *definitions* are a snapshot.

### Claude

- **No Refresh button.** The help center says: "If you're hoping to edit a custom connector, you'll need to remove it first, then re-add it" ([support](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp); also [claude.com docs](https://claude.com/docs/connectors/custom/remote-mcp)). The connector's page lists its tools under **Tool permissions** ([testing](https://claude.com/docs/connectors/building/testing)).
- **Unsupported features.** Claude doesn't support resource subscriptions or draft capabilities ([Build an MCP server for Claude](https://claude.com/docs/connectors/building)).
- **Community reports**, no Anthropic answers:
  - claude.ai on the **web** and Claude Code read a fresh `tools/list` for each new conversation.
  - The **desktop and mobile apps** keep the list from when the connector was added ([claude-code#38324](https://github.com/anthropics/claude-code/issues/38324), 2026-03).
  - The desktop app may refresh only after the app is relaunched. It ignores `list_changed` (it opens no `subscriptions/listen` stream) and the `tools/list` TTL. The web refreshes even within a chat ([claude-code#88172](https://github.com/anthropics/claude-code/issues/88172), 2026-08, open).
  - The proxy for remote connectors caches `tools/list` and never delivers `list_changed` ([claude-code#41123](https://github.com/anthropics/claude-code/issues/41123)).
  - A non-ASCII connector name can keep tools out of a chat ([claude-ai-mcp#552](https://github.com/anthropics/claude-ai-mcp/issues/552)). "Resonate" is plain ASCII, so this doesn't affect us.

### The MCP spec

- **2025-11-25.** A server that declares `tools.listChanged` SHOULD send `notifications/tools/list_changed` ([tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)). Nothing makes a client re-read on a new `serverInfo.version`, new `instructions` or new annotations.
- **2026-07-28 (the current revision)** ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)):
  - The protocol is stateless.
  - `server/discover` is added.
  - `list_changed` only travels on a `subscriptions/listen` stream that the client opens.
  - `tools/list` carries `ttlMs` / `cacheScope`.
  - Clients MAY re-read early after an unexpected "method not found / invalid params" ([caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching)).
  - These are all hints. No client we use is shown to act on them.

### Our server (SDK `@modelcontextprotocol/server` 2.4.0, read from the package)

- **`listChanged` is advertised for us.** `McpServer.registerTool` advertises `tools.listChanged: true` unless the constructor's `capabilities` says otherwise.
- **We can never send the notification.** `createMcpHandler` serves `subscriptions/listen` from an in-memory bus that belongs to the handler. Ours makes a fresh handler and server for every request, so a listen stream would hold the function open and never carry a notification. `sendToolListChanged()` has no connection to send on.
- **TTL is already zero.** `cacheHints` defaults to `ttlMs: 0`, `cacheScope: "private"` for 2026-era results, and doesn't affect 2025-era ones. So a client that honours the TTL already re-reads every time.
- **`serverInfo.version` was a constant `"1.0.0"`.**

**Conclusion:** neither client offers a refresh signal a server can send. The only levers are the user's Refresh in ChatGPT, a new conversation on claude.ai's web, relaunching Claude's app, and remove + re-add. The fix is to stop needing them.

## The design

1. **Frozen surface: 15 tools, for good.** `index.ts` says so at the top. `tools/mcpcatalog.mjs` fails if a tool is added, renamed, removed or reordered.
   - Coaching: `start_vocal_coaching`, `get_status`, `list_songs`, `get_song`, `list_takes`, `get_take`, `get_live_lines`, `get_progress`, `get_voice_profile`.
   - The Score: `get_score_view`, `get_score_xml`, `get_score_pdf`.
   - New and last: `get_capabilities` (read-only), `read_resonate` (read-only).
   - The one that acts: `control_resonate`.
2. **Open schemas on the two routing tools.**
   - `control_resonate {action, …}`: `action` is a plain string, not an enum. The v88 fields stay, with their types relaxed: no enums, no ranges.
   - `read_resonate {what, song?, …}`: `what` is a query name, or the name of the tool that does the same read (`get_status`).
   - Both are `z.looseObject` and take an `args` object. A parameter added later can be passed as a field or inside `args`, and a client's old copy of the schema can't block it.
   - The server checks each call against `catalog.ts`: type, range, listed values (case-insensitive) and required parameters. Only the parameters an action takes reach the page. Anything else is named in `ignored_params`.
3. **The catalogue is the contract** (`catalog.ts`, no imports).
   - `ACTIONS` has 17 entries, `QUERIES` has 13. Each entry has `about`, `params`, `starts` (it makes sound, so it can't be queued for a page that isn't in front) and `score` (no coaching reminder).
   - `VERSION` and `CHANGES` are kept here.
   - `READERS` in `resonate.ts` is typed `satisfies Record<QueryName, …>`, so the type-check fails if a query has no handler.
4. **Discovery happens through answers, which are always live.**
   - `get_capabilities` returns every action and read, with its parameters in words, the version and the latest changes (~5.6 KB).
   - `get_status` and `start_vocal_coaching` (which assistants call first) carry `capabilities: {version, control_resonate: [names], read_resonate: [names], details}`.
   - An unknown action or read answers with the full list.
   - The instructions, the routing tools' descriptions and the playbook's cheat-sheet point to `get_capabilities`. That wording never goes stale.
5. **Version.** `catalog.ts` `VERSION` (`2026-11-20`) is also `serverInfo.version` and `get_capabilities.version`. It's for people, logs and tests: no client re-reads because of it.
6. **`tools.listChanged: false`.** It's honest: we can't send the notification. It also gives a 2026-era client no reason to open a `subscriptions/listen` stream for tools. We don't implement `list_changed` or subscriptions.
7. **Discovery is logged.** Every JSON-RPC message logs one line in the function's logs: `mcp <method>[ <tool>:<action|what>][ <clientInfo>][ <protocol>] client=<client_id> v=<VERSION>`. Arguments are never logged. This shows when ChatGPT or Claude re-reads the tool list (`initialize`, `server/discover`, `tools/list`).

**Rejected:**
- Per-version tool names (`control_resonate_v2`): every one needs a refresh.
- Moving everything into one `call {name, args}` tool: it loses the read-only / acting split that ChatGPT's approval prompts and voice mode rely on.
- Pushing `list_changed`: no client acts on it, and stateless serving can't send it.
- Exposing `ttlMs`: it's already 0, and it's ignored.

## Adding an ability from now on (no client step)

- **An action the page does:**
  1. Handle it on the page: `sing.js` `runRemote`, `play.js` `scoreRun`, `shell/remote.js`, plus that page's `handles()`.
  2. Add an entry to `ACTIONS` with `about`, `params`, and `starts` / `score` where they apply.
  3. Bump `VERSION` and add a `CHANGES` line.
  4. Deploy the function.
- **A new read:**
  1. Write the function in `resonate.ts`.
  2. Add an entry to `QUERIES` and to `READERS` (the type-check enforces this).
  3. Bump `VERSION` and deploy.
- **A new parameter:** add it to the entry's `params`, optional. Never make an existing optional parameter required.
- **Never:**
  - add, rename, remove or reorder a tool;
  - change a tool's input schema or annotations;
  - remove or rename an action, query or parameter (keep the old one working, as an alias if it has to change);
  - rely on edited `instructions` or tool descriptions: those reach ChatGPT only after a Refresh, and Claude's apps only after a re-add.
- **The coaching playbook (`coaching.ts`) is live** (it's part of a tool answer) and can change at any time.
- **Checks:**
  - `node --experimental-strip-types tools/mcpcatalog.mjs` runs offline and is in `regress.sh`.
  - After deploying, run `tools/mcp1.cjs` and `tools/mcp2.cjs` live.

## What changed (2026-11-20)

- **`supabase/functions/mcp/catalog.ts` (new):**
  - the actions and queries;
  - the parameter checker (`checkParams` and `gather`: fields win over `args`; blank text counts as missing; numeric strings are accepted);
  - `capabilitiesData` and `capabilitiesBrief`;
  - `VERSION` and `CHANGES`.
- **`index.ts`:**
  - `version: VERSION` and `capabilities.tools.listChanged: false`;
  - the two new tools;
  - `control_resonate`'s open schema, with a description that points to `get_capabilities`;
  - the frozen-list rule in the header;
  - `logRpc`.
- **`resonate.ts`:**
  - `control()` is driven by the catalogue. Unknown action → the list. A parameter is checked before the device is looked up. `score_open`'s song is a required parameter.
  - `read()`, `READERS`, `capabilities()`.
  - the `capabilities` brief in `get_status` and `start_vocal_coaching`;
  - one paragraph in `INSTRUCTIONS`.
- **`coaching.ts`:** one cheat-sheet line about `get_capabilities`. `mcp1.cjs` compares the deployed playbook with this file, so deploy both together.
- **`tools/mcp1.cjs`:** the 15 frozen names; the deployed `VERSION` equals `catalog.ts`; `listChanged` is false; `read_resonate` works by a tool's name; an unknown action returns the list.
- **`tools/mcpcatalog.mjs` (new):** guards the frozen list and the open schemas, and checks the catalogue's parameter rules. Added to `tools/regress.sh`.

**Behaviour changes (small):**
- Parameters an action doesn't take are no longer sent to the page. They come back in `ignored_params`.
- `set_tempo` percentages that aren't offered, a `sing` view other than perform / practice, and fractional line numbers are refused by the server with the allowed values. The page used to refuse them.
- Every other answer is unchanged, except the new `capabilities` brief in `get_status` and `start_vocal_coaching`.

**Checked here:**
- `tsc` 6.0.2 over `index.ts` with the function's real npm dependencies (Deno isn't installed in this container) is clean. A deliberately missing reader is caught.
- The real `build()` was driven through the SDK's own `createMcpHandler` under Node with a fake Supabase client. `initialize` and `server/discover` give version `2026-11-20` and `listChanged: false`. `tools/list` has 15 tools and `ttlMs: 0`. `control_resonate` sends exactly the checked parameters, and `sing` still gets its `delay` / `prev_take`. `read_resonate`, the errors and the `get_status` brief all work.
- `mcpcatalog.mjs` passes 18 of 18 checks.

## Deploy (the integrator)

With the Supabase connector's `deploy_edge_function`: name `mcp`, `verify_jwt: false`, `import_map_path: "deno.json"`. Include the files `index.ts`, `resonate.ts`, `coaching.ts`, **`catalog.ts` (new)**, `deno.json` and `deno.lock`.

Then — **always, before calling it done** — make one real signed-in call: a local run proves nothing about the edge runtime.
1. Run `tools/mcp1.cjs` and `tools/mcp2.cjs` (live, test user) — or, quicker, call a Resonate tool from a session that has the connector (list_songs, get_score_xml).
2. Check the function's logs for `mcp tools/list … v=2026-11-20`.

## The owner, once

- **ChatGPT** (web):
  1. At chatgpt.com/plugins, open Resonate and press **Refresh**.
  2. Its tool list should show 15 tools, including `get_capabilities` and `read_resonate`. Switch both on if they're off.
  3. If there's no Refresh, or the two don't appear: delete the connector and add it again (`https://ltyadhjhnfxdlgsmrcds.supabase.co/functions/v1/mcp`, OAuth, Allow). This is the last time.
  4. Start a new chat.
- **Claude:**
  - claude.ai on the web: a new chat should be enough. Settings → Connectors → Resonate → Tool permissions should list 15 tools.
  - The desktop or mobile app: quit and relaunch. If it still lists 13, remove the connector and add it again.
- **After a re-add,** Resonate → Assistants may show the old connection as well (every re-add registers a new OAuth client). Remove the old one.

## Verify

1. In a new chat: "Use Resonate's get_capabilities: what version is it?" The answer should be 2026-11-20.
2. The function's logs show `mcp tools/call get_capabilities client=…`.
3. The real test comes with the next ability. Add it as above (catalogue entry + page + deploy) and ask for it **in an existing chat, with no client step**. The assistant should find it in `get_capabilities`, or in the brief in `get_status`, and call `control_resonate {action: "<new>"}`.

## Incident: every request failed for ~4 hours (2026-11-20)

The first deploy of this design (function version 7, 17:23 UTC) logged each JSON-RPC message from `req.clone().json()`. In Supabase's edge runtime, reading the clone's body left the original unreadable. The SDK answered every signed-in POST with `400 Parse error: the request body could not be read`, a path that doesn't call `onerror`, so the logs showed only the 400s. ChatGPT, Claude and Claude Code all failed: `server/discover` (2026-07-28), the legacy `initialize` they fell back to, and `tools/call` alike. Local Deno doesn't reproduce it, and only the unauthenticated 401 was checked after the deploy.

Fixed in version 8 (21:19 UTC): `readOnce` reads the body once and passes the SDK a fresh `Request` plus `parsedBody`. `logFailure` logs any JSON error a POST is answered with, giving its code and message. tools/mcpcatalog.mjs fails on a `.clone()` in index.ts. Clients needed no step: a new chat, or a retry, connects again.

## Watch

- **`subscriptions/listen` in the logs.** Claude's client speaks the 2026 protocol (#88172 shows `server/discover`). If `mcp subscriptions/listen` lines appear, each one is a stream that holds the function open until the client leaves. In that case, answer it at once in `index.ts` before `createMcpHandler`. It hasn't been seen yet; the logs will tell.
- **ChatGPT's per-tool switches.** Switching a tool off is the user's choice. With no new tools there's nothing new to switch on.
- **If a new tool is ever unavoidable** (an MCP App UI resource, a separate destructive tool): follow the owner's steps above once more, and add a `CHANGES` line that says so.
