# dsh-tools-toggle

[![Platform: DSH Web plugin](https://img.shields.io/badge/platform-DSH_Web_plugin-2563eb)](https://github.com/pinion05/dsh-tools-toggle)
[![Version: 0.1.0](https://img.shields.io/badge/version-0.1.0-blue)](https://github.com/pinion05/dsh-tools-toggle/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

<p align="center"><img src="icon.svg" width="120" alt="Tools Toggle icon — two switches, one on and one off" /></p>

**Turn DeepSeek Harness (DSH) model tools on and off with a switch, from the web Settings page.** Every inherited tool — `bash`, `web_search`, `web_fetch`, whatever your presets and plugins add — shows up as one row with a toggle. Flip it off and the tool disappears from the model's view entirely: no schema in the request, no description in the prompt, no execution on call. Flip it back on and the next session gets it again.

## Why

DSH gives agents a fixed tool surface, and every tool on it costs tokens on every request and invites the model to reach for it. Sometimes you want less: a session that never touches the network, a focused agent without the noise of twenty irrelevant tools, or a quick A/B of whether a tool is helping at all. The built-in answer was hand-editing the profile patch and restarting.

dsh-tools-toggle is that switch, in the UI, with one click — and it removes the tool from the model's *knowledge*, not just its permissions, so the tokens go away too.

## How it works

1. **Settings → Tools** — the plugin mounts a section in the native Settings page: the full catalog of inherited tools (preset-plane tools included), each with its name, one-line description, a search box, and a "disabled only" filter.
2. **Persistence through config** — a toggle POSTs to the plugin's host route, which writes the deny list into the plugin's Loader-entry config via the settings service. The change lands in the profile patch (user layer), so it survives upgrades. Writes are serialized so rapid toggles never stack on a stale base, and reads wait for pending writes (read-your-writes).
3. **Hiding via restriction** — the host half applies the list by calling `agent.ctx.tools.restrict({ deny })` once per agent. A denied tool loses schema, lookup, and execution *together* — the weakest mechanism that still removes it — so the model never learns it existed. Guessing the name anyway gets a clean `UNKNOWN_TOOL` rejection.

### The creation-time snapshot

A restriction rewrites the model-facing tool array, which is part of the request prefix — applying it to a *live* conversation would invalidate the provider prefix cache from the first changed token. So the deny list is applied **when an agent is created**, and never touched afterward:

- New sessions (and new subagents) get the current toggle state.
- Existing conversations keep their tool surface — and their cache — until they naturally end.
- A host restart resumes sessions as new agents, so changes made between boots apply on resume (one unavoidable re-prefill).

### What can't be broken

- **Scope-local machinery is exempt by construction** — subagent delegation's structured-output plumbing and the reserved PTC `run_code` transport are never toggleable, so workflows and multi-agent setups keep running.
- **You can't lock yourself out** — the toggle state lives in the UI, not in the tools, so even with every switch off the Settings page still works and restores everything.
- **Core tools ask first** — disabling `bash`, `read`, `write`, or `edit` pops a one-time confirm dialog.

## Install

```sh
git clone https://github.com/pinion05/dsh-tools-toggle.git
dsh plugin --profile web add ./dsh-tools-toggle
```

Refresh DSH Web and open **Settings → Tools** (Korean and English locales included).

Plain ESM, no build step. Peers (`cordis`, `dsh-tools`, `dsh-host-webserver`) resolve from the DSH install tree; for a link-based dev setup, symlink `node_modules` to the DSH installation's own `node_modules`, since `pnpm link:` cannot resolve peers by itself.

## Notes & limitations

- **New sessions only.** Live conversations are deliberately untouched — that's the prefix-cache protection, not a bug.
- **The catalog needs a session.** Tool names are snapshotted from live agents, so before the first session the page shows a "start a session" hint.
- **Profile-wide, not per-session.** One deny list for the whole profile; per-session overrides are future work.
- **Toggle UI only, no agent tool.** Re-enabling is policy relaxation, so it stays human-only by design.

## License

[MIT](./LICENSE) © pinion05
