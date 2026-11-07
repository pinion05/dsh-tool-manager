# dsh-tool-manager

[![Platform: DSH Web plugin](https://img.shields.io/badge/platform-DSH_Web_plugin-2563eb)](https://github.com/pinion05/dsh-tool-manager)
[![Version: 0.5.0](https://img.shields.io/badge/version-0.5.0-blue)](https://github.com/pinion05/dsh-tool-manager/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

<p align="center"><img src="icon.svg" width="120" alt="Tool Manager icon — two switches, one on and one off" /></p>

**`@npmc_5/dsh-tool-manager` is a per-preset tool manager for DeepSeek Harness (DSH).** It mounts a **Tool Manager** section in the web Settings page where each agent preset gets its own view of the tools it *actually* enables: flip a switch and the tool is hidden from the model for that preset only — no schema in the request, no lookup, no execution — click a row to inspect what the tool does and which plugin registers it. All of it without editing a profile patch or restarting the host.

## Highlights

- **Preset-accurate baseline.** The list is read straight from the preset's own retained scope through an isolated lease, so no live session is required and the plugin's own deny restrictions cannot pollute it. Tools the preset disables by default never appear, because they never register.
- **Per-preset hide lists that can't clobber siblings.** Every HTTP write names exactly one preset key, and the settings service deep-merges dict keys — sibling presets are structurally untouchable, by construction rather than by discipline.
- **Tool detail inspector.** Click a row (or press Enter/Space) to expand an inline panel: the registering plugin's package name (`core` for built-ins, an explicit "unknown source" rather than a wrong name when attribution isn't possible), the tool's full parameter JSON schema, and its complete description. One panel open at a time; it collapses when you switch presets.
- **Bulk enable/disable with confirm.** *Enable all* clears the preset's hide list (the button shows how many toggles it will clear); *Disable all* denies a snapshot of the preset's current baseline after a confirm dialog. While any write is in flight, the preset chips, tool switches, and bulk buttons lock so a scope can't change mid-write.
- **Safe persistence.** State lives in the plugin's own Loader-entry config and is written exclusively as single-key partial patches through the settings service, on a serialized write chain. A failed persist rolls back only the key that failed — intents already accepted for sibling keys survive and persist in their own queued patches. Externally committed changes (hand-edits, other writers) are re-synced, and each mount re-syncs from the committed file when no write is queued.
- **Hard timeouts everywhere.** The preset roster (1.2 s) and each baseline lookup (2.5 s) run against deadlines, so a wedged plugin in the loader tree degrades to a "failed to load" chip or an inline error instead of freezing the Settings page.
- **New sessions only — on purpose.** A restriction rewrites the model-facing tool array, which is part of the request prefix; applying it mid-conversation would invalidate the provider prefix cache from the first changed token. So the deny list is applied when an agent is created, and live sessions are left alone. The only re-applications are restore-only (see [How it works](#how-it-works)): identical surface, zero cache cost.
- **Mount-time restore.** A plugin (re)mount disposes the previous instance's restrictions; on mount the current deny is re-applied to live agents, which only ever restores a prior restriction.

## Install

From a DSH profile:

```sh
dsh plugin --profile <name> install /path/to/dsh-tool-manager
```

or install the bundle through DSH's plugin manager (`plugin_manager` → `install_bundle`) pointed at the package directory. Once published, the npm package `@npmc_5/dsh-tool-manager` installs the same way as a bundle spec. Requires DSH `>=0.2.0-rc.1 <0.3.0-0`.

Plain ESM, no build step, no client bundler — the web half is plain `React.createElement` served straight from `lib/client.js`. Peer packages resolve from the DSH install tree; for a link-based dev setup, symlink `node_modules` to the DSH installation's own `node_modules`.

Refresh DSH Web and open **Settings → Tool Manager** (Korean and English locales included).

## Usage

- **Preset chips.** One chip per agent preset, the default marked `·default` and auto-selected when the page opens. A preset whose scope fails to load is struck through with `!` and explains why on hover.
- **Toggling.** Each row is one tool the preset enables by default, with its one-line description. Flip the switch off and the tool is hidden for *this preset only*, starting with the next session. Disabling a core tool (`bash`, `read`, `write`, `edit`) asks for confirmation first. Updates apply optimistically and are confirmed by a re-read of the catalog.
- **Detail panel.** Click a row to inspect it: **Source** (the plugin package that registers the tool), **Parameters** (the JSON schema sent to the model, pretty-printed and scrollable), and the full description.
- **Bulk buttons.** *Enable all* (`전부 활성화`) resets the preset to its defaults — an empty hide list denies nothing. *Disable all* (`전부 비활성화`) turns off every tool in the baseline snapshot; tools the preset gains *later* stay enabled and visible, so nothing is ever blocked invisibly.
- **Search & filter.** Free-text search over names and descriptions, a "disabled only" filter, and a live disabled count.

Team and scope-local tools (`spawn_teammate`, `team_task_*`, delegation structured-output plumbing) are registered per agent scope and are exempt from restrictions by DSH's tools design — they never appear in the list. See [Limitations](#limitations--notes).

## How it works

1. **Hiding via restriction.** For each agent, the deny list is applied as one `agent.ctx.tools.restrict({ deny })` call. A denied tool loses schema, lookup, and execution *together* — the weakest mechanism that still removes it — so the model never learns it existed.
2. **Per-preset resolution.** The agent's preset is read through the agent-preset registry (`composedPreset`), and only that preset's list is denied. Preset switches re-resolve through the registry's `tools/change` event.
3. **Baseline via an isolated lease.** `registry.acquireScope(presetId)` leases the preset's own retained scope, so the catalog reflects exactly what the preset enables by default — no live session needed, and the plugin's own restrictions (registered on agent scopes) cannot pollute the result.
4. **State in volatile plugin config.** The hide lists live in the plugin's Loader-entry config (`presets`), written only by the plugin's HTTP routes through the settings service. Accepted writes land in an in-memory authoritative store first (so immediate re-reads see them), then persist as single-key `{ presets: { <id>: [...] } }` patches on a serialized chain.

## Configuration

The plugin exposes a single config field:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `presets` | `dict<preset id, string[]>` | `{}` | Disabled inherited tool names, keyed by preset id. |

It is marked volatile (live-editable without a remount) and is owned by the plugin's HTTP routes — normally you edit it through the Settings UI, never by hand. The committed state is a plain dict in the profile patch:

```json
{
  "presets": {
    "focused-coding": ["web_search", "web_fetch"],
    "research": ["write"]
  }
}
```

Hand-edits and other writers are detected (volatile-update event while idle, and on every mount) and re-synced into the running store.

## Limitations & notes

- **New sessions only.** Toggles take effect for new sessions and new subagents. Live conversations keep their tool surface — that's prefix-cache protection, not a bug. A host restart resumes sessions as new agents, so changes made between boots apply on resume.
- **Exempt by construction.** The reserved PTC `run_code` transport and scope-local machinery (subagent delegation structured output) are never toggleable, so workflows and multi-agent setups keep running.
- **Zero-tool presets are protected.** "Disable all" on a preset that exposes no tools is refused (`error.proto.emptyBaseline`) rather than silently wiping its existing overrides, and a broken baseline lookup fails loudly (`error.proto.baselineUnavailable`).
- **Disable all is a snapshot.** Tools registered by the preset after the bulk action stay enabled — re-run the action if you want them hidden.
- **Mutations are same-origin enforced.** Cross-origin POSTs are rejected; direct API clients (no `Origin` header) are allowed. Request bodies are capped at 1 MiB.
- **Attribution is best-effort.** A tool whose registering scope no loader row owns shows "unknown source" instead of a guessed name.

## License

[MIT](./LICENSE) © pinion05 — [github.com/pinion05/dsh-tool-manager](https://github.com/pinion05/dsh-tool-manager)
