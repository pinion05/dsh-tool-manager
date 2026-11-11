/**
 * @npmc_5/dsh-tool-manager — host half.
 *
 * Hides inherited model tools from every agent scope by applying one deny
 * restriction per agent through `agent.ctx.tools.restrict({ deny })`:
 * hidden tools lose schema, lookup, and execution together (the weakest
 * mechanism that still removes them from the model's view), while scope-local
 * machinery (delegation structured output) and the reserved PTC `run_code`
 * transport stay exempt by construction.
 *
 * v0.4.0: the former global `disabledTools` list is GONE — toggles are
 * strictly per agent preset (`presets[presetId]`), because a preset-agnostic
 * list could not tell which preset's surface a tool even belongs to. Every
 * HTTP write names exactly one preset key, and `settings.update` deep-merges,
 * so sibling preset keys are structurally unclobberable.
 *
 * Persistence rules learned the hard way (see README):
 *  - settings.update deep-merges dict keys; the authoritative write view is
 *    the module-scope WRITE_STORE below. IMPORTANT: a volatile-only settings
 *    write does NOT remount this fiber — the runtime commits the new value
 *    into the live config refs in place (`_commitVolatile`), so `apply()`
 *    does not re-run on our own writes. The store therefore needs explicit
 *    freshness sources: (a) every accepted write mutates it synchronously,
 *    (b) `loader/volatile-update` re-syncs it when the committed config
 *    changes behind our back (hand-edits, other writers), and (c) a mount
 *    re-syncs it when the write chain is idle (source HMR / enable-disable
 *    remounts). Module scope survives remounts in-process; a host restart
 *    reloads the module and re-initializes from the committed file state.
 *  - A failed persist re-syncs ONLY the failed key, so intents queued behind
 *    the failure (already accepted with ok:true) survive in the store and
 *    are persisted by their own queued patches.
 *  - Toggles apply to NEW agents only; a (re)mount re-applies the CURRENT
 *    deny to live agents, which only ever RESTORES a previous restriction
 *    (identical surface ⇒ no prefix-cache cost).
 */
import Schema from "@deepseek-ai/schemastery";
import { scopeOf } from "@deepseek-ai/dsh-scope";
import { TokenizerService, DEFAULT_TOKENIZER_URL } from "./tokenizer.js";

export const name = "tool-manager";

export const inject = ["tools", "agents", "settings", "webServer"];

export const Config = Schema.object({
	/*
	 * `volatile`: the settings service only writes form fields marked volatile
	 * (live-editable without a remount); this field is owned entirely by this
	 * plugin's HTTP route through `settings.update`.
	 */
	presets: Schema.dict(Schema.array(Schema.string())).default({}).volatile().description("Disabled inherited tool names, keyed by preset id."),
	/*
	 * Context token accounting: counts use the model family's own tokenizer
	 * (HF tokenizer.json, byte-level BPE) on the text the serving stack
	 * renders into the prompt. `tokenizerPath` overrides the tokenizer file
	 * (absolute path, e.g. a future GLM release's tokenizer.json); otherwise
	 * a cached copy under ~/.dsh/cache/tool-manager is used, downloaded from
	 * `tokenizerUrl` on first use.
	 */
	tokenizerPath: Schema.string().default("").description("Absolute path to a tokenizer.json used for context token counts (overrides the download)."),
	tokenizerUrl: Schema.string().default(DEFAULT_TOKENIZER_URL).description("Download source for the tokenizer.json used for context token counts."),
});

const SETTINGS_NS = "tool-manager";
const API_PREFIX = "/api/npmc_5/tool-manager";
const RESERVED_TRANSPORT = "run_code";
const PRESETS_TIMEOUT_MS = 1200;
const BASELINE_TIMEOUT_MS = 2500;

/**
 * Volatile config fields arrive as live references (`{ get(): T }`, updated in
 * place by the runtime without a remount); plain values arrive as-is.
 */
const readValue = (value) => {
	if (value !== null && typeof value === "object" && typeof value.get === "function") return value.get();
	return value;
};

const readPresetMap = (value) => {
	const inner = readValue(value);
	if (inner === null || typeof inner !== "object") return {};
	const out = {};
	for (const [key, list] of Object.entries(inner)) {
		if (!Array.isArray(list)) continue;
		const names = list.filter((entry) => typeof entry === "string");
		if (names.length > 0) out[key] = names;
	}
	return out;
};

/**
 * Authoritative write view, deliberately at MODULE scope: the first settings
 * write after a (re)mount remounts the plugin fiber, and a fresh instance
 * reading its (possibly frozen) config refs could otherwise restate a stale
 * value over newer entries. Module scope survives remounts in-process, so
 * old and new instances serialize on one chain and the mirror never
 * regresses; a host restart reloads the module and re-initializes the store
 * from the committed file state.
 */
const WRITE_STORE = {
	presets: new Map(),
	chain: Promise.resolve(),
	/** In-flight (queued-but-not-run) settings writes; blocks freshness resyncs. */
	pending: 0,
};

/** Resolve within `ms` or fall back to `fallback` (the underlying promise keeps running and cleans up after itself). */
const withTimeout = (promise, ms, fallback) => Promise.race([
	promise,
	new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
]);

function apply(ctx, config) {
	/** agent -> restriction disposer (also owned by the agent scope itself) */
	const disposers = new Map();
	/** agent -> the deny list currently applied (sorted), to skip no-op reapplications */
	const appliedDeny = new Map();
	/** tool name -> { description, parameters, source }, snapshotted before any restriction hides it */
	const catalog = new Map();

	/**
	 * Real-tokenizer context accounting for the catalog UI. Counts the text
	 * the serving stack renders per tool (GLM chat template) with the model
	 * family's own byte-level BPE; see lib/tokenizer.js for the verified
	 * fidelity notes. Lazy: the first catalog request triggers the (cached)
	 * tokenizer load, and early responses answer status "loading".
	 */
	const tokenizer = new TokenizerService({
		logger: ctx.logger,
		sourcePath: readValue(config.tokenizerPath),
		url: readValue(config.tokenizerUrl),
	});

	/**
	 * Tool name → registering package. The tools registry cannot attribute
	 * per row (all preset rows share one scope layer), so this scans the
	 * installed plugin packages once: every `name: "<tool>", description:`
	 * pair in a package's lib/index.js maps that tool to the package name.
	 * Cached at module scope; unknown tools resolve to "" (the client shows
	 * an "unknown source" hint).
	 */
	let PACKAGE_TOOL_MAP = null;
	const toolPackageIndex = () => {
		if (PACKAGE_TOOL_MAP !== null) return PACKAGE_TOOL_MAP;
		const map = new Map();
		try {
			const require = process.getBuiltinModule("node:module").createRequire(import.meta.url);
			const fs = process.getBuiltinModule("node:fs");
			const path = process.getBuiltinModule("node:path");
			const packageDirs = [];
			const pushScopeDir = (dir) => {
				let scopes = [];
				try {
					scopes = fs.readdirSync(dir, { withFileTypes: true });
				} catch { /* scope dir unreadable */ }
				for (const scope of scopes) {
					const scopeDir = path.join(dir, scope.name);
					/* link: dependencies are symlinks — stat (follow) rather than dirent checks */
					let isDir = false;
					try {
						isDir = fs.statSync(scopeDir).isDirectory();
					} catch { /* dangling */ }
					if (!isDir) continue;
					let packages = [];
					try {
						packages = fs.readdirSync(scopeDir, { withFileTypes: true });
					} catch { /* scope unreadable */ }
					for (const pkg of packages) {
						const pkgDir = path.join(scopeDir, pkg.name);
						let pkgIsDir = false;
						try {
							pkgIsDir = fs.statSync(pkgDir).isDirectory();
						} catch { /* dangling */ }
						if (pkgIsDir && !pkg.name.startsWith(".")) packageDirs.push(pkgDir);
					}
				}
			};
			try {
				const toolsDir = path.dirname(require.resolve("@deepseek-ai/dsh-tools/package.json"));
				pushScopeDir(path.resolve(toolsDir, "..", ".."));
			} catch { /* dsh-tools unresolved */ }
			/*
			 * Profile-linked packages: node realpath-resolves the plugin's
			 * symlink, so import.meta.url points at the source checkout —
			 * prefer the profile context dir, then $DSH_PROFILE_DIR, then the
			 * (usually wrong) import-derived path as a last resort.
			 */
			const profileDir = ctx.profileContext?.dir ?? process.env.DSH_PROFILE_DIR;
			const profileNodeModules = profileDir
				? path.join(profileDir, "node_modules")
				: path.resolve(path.dirname(import.meta.url.replace(/^file:\/\//, "")), "..", "..", "..");
			if (path.basename(profileNodeModules) === "node_modules") pushScopeDir(profileNodeModules);
			/*
			 * Tool definitions appear in several shapes: name then description
			 * on the next line, either quote style, and entry files named
			 * lib/index.js, index.js, or lib/*.js.
			 */
			const pattern = /name:\s*["']([a-z_]+)["'],\s*\n\s*description:/g;
			for (const dir of packageDirs) {
				const scopeName = path.basename(path.dirname(dir));
				const pkgName = scopeName.startsWith("@") ? `${scopeName}/${path.basename(dir)}` : path.basename(dir);
				const candidates = [path.join(dir, "lib", "index.js"), path.join(dir, "index.js")];
				try {
					const libDir = path.join(dir, "lib");
					for (const file of fs.readdirSync(libDir, { withFileTypes: true })) {
						if (file.isFile() && file.name.endsWith(".js") && file.name !== "index.js") candidates.push(path.join(libDir, file.name));
					}
				} catch { /* no lib dir */ }
				for (const file of candidates) {
					try {
						const text = fs.readFileSync(file, "utf8");
						for (const match of text.matchAll(pattern)) if (!map.has(match[1])) map.set(match[1], pkgName);
					} catch { /* unreadable candidate */ }
				}
			}
		} catch { /* attribution is best-effort by contract */ }
		PACKAGE_TOOL_MAP = map;
		return map;
	};

	/** Attribution for one tool: scoped-layer owner, then package scan, then "" (unknown). */
	const sourceFor = (name) => sourceByScope.get(name) ?? toolPackageIndex().get(name) ?? "";

	/**
	 * Best-effort tool → registering scope attribution. Walks every scoped
	 * tools layer (scope key → layer) plus the global layer, names each scope
	 * through the host loader rows. Most preset rows share the generation
	 * scope, so this usually only resolves host-tree tools; the package scan
	 * above covers the rest.
	 */
	const sourceByScope = new Map();
	const refreshSourceByScope = () => {
		sourceByScope.clear();
		try {
			const namesByScope = new Map();
			for (const row of ctx.loader?.entries?.() ?? []) {
				try {
					const key = scopeOf(row?.ctx ?? row?.fiber?.ctx);
					if (key !== void 0 && key !== null && !namesByScope.has(key)) {
						namesByScope.set(key, typeof row.options?.name === "string" ? row.options.name : String(row.options?.id ?? ""));
					}
				} catch { /* row without a resolvable scope */ }
			}
			const layers = ctx.tools.layers;
			for (const [key, layer] of layers.scoped) {
				const owner = namesByScope.get(key);
				if (owner === void 0) continue;
				for (const [tool] of layer.tools.entries()) sourceByScope.set(tool, owner);
			}
		} catch { /* attribution is best-effort by contract */ }
	};
	/** Guard: `restrict`/dispose emit `tools/change`; swallow our own echoes. */
	let suppressing = false;

	/** The committed file state is the truth; used on mount and external changes. */
	const syncStoreFromConfig = () => {
		WRITE_STORE.presets = new Map(Object.entries(readPresetMap(config.presets)));
	};

	/** Re-sync ONE preset key after its persist failed; sibling keys keep their queued intents. */
	const syncKeyFromConfig = (key) => {
		WRITE_STORE.presets.set(key, readPresetMap(config.presets)[key] ?? []);
	};

	/**
	 * Queue one settings update. The patch is computed at run time from the
	 * store, so queued patches coalesce over later mutations of the same key.
	 * `key` names the only preset key the patch can affect — on failure just
	 * that key is re-synced from config, keeping queued intents for other
	 * (and later) mutations intact.
	 */
	const persist = (key, computePatch) => {
		WRITE_STORE.pending++;
		WRITE_STORE.chain = WRITE_STORE.chain.then(async () => {
			try {
				const patch = computePatch();
				await ctx.settings.update(SETTINGS_NS, patch);
			} catch (error) {
				console.error(`[tool-manager] settings.update failed: ${String(error?.stack ?? error)}`);
				if (key === null) syncStoreFromConfig();
				else syncKeyFromConfig(key);
			} finally {
				WRITE_STORE.pending--;
			}
		}).catch(() => {});
		return WRITE_STORE.chain;
	};

	/*
	 * Freshness: a volatile-only config commit never remounts this fiber, so
	 * externally committed changes (hand-edits, other writers) arrive here
	 * only through this event. The loader reports the changed paths per
	 * fiber; re-sync while no write of ours is queued (a queued patch reads
	 * the store at run time and would otherwise observe a foreign state).
	 */
	ctx.on("loader/volatile-update", (paths) => {
		if (WRITE_STORE.pending !== 0 || !Array.isArray(paths)) return;
		const touched = paths.some((entry) => Array.isArray(entry) ? entry[0] === "presets" : entry === "presets");
		if (touched) syncStoreFromConfig();
	});

	const restrictableNames = (agent) => {
		try {
			const view = agent.ctx.tools.view(agent);
			if (view && view.restrictableNames instanceof Set) return view.restrictableNames;
		} catch {
			/* fall through to the public-surface fallback */
		}
		const names = new Set();
		try {
			for (const schema of agent.ctx.tools.schemas()) {
				if (schema.name !== RESERVED_TRANSPORT) names.add(schema.name);
			}
		} catch {
			/* agent mid-teardown */
		}
		return names;
	};

	/** Preset id the agent is currently bound to, or undefined when unbound/unknown. */
	const presetOf = (agent) => {
		try {
			const registry = ctx.get("agentPresets");
			const id = registry?.composedPreset?.(agent.ctx);
			return typeof id === "string" && id.length > 0 ? id : void 0;
		} catch {
			return void 0;
		}
	};

	/** The preset's deny list, from the store. */
	const disabledFor = (presetId) => new Set(presetId === void 0 ? [] : WRITE_STORE.presets.get(presetId) ?? []);

	/*
	 * Catalog from the INHERITED (restrictable) surface only: scope-local
	 * machinery (delegation structured output, …) is not toggleable and must
	 * not appear. Preset-plane tools can register after `agent/created`, so
	 * the GET route re-snapshots live agents before responding.
	 */
	const snapshotCatalog = (agent) => {
		try {
			let names;
			let byTool;
			try {
				const view = agent.ctx.tools.view(agent);
				if (view && view.restrictableNames instanceof Set) {
					/* schemas() with no scope reads the GLOBAL view; the agent view carries the preset plane. */
					names = [...view.restrictableNames];
					byTool = new Map([...view.visible.values()].map((definition) => [definition.name, definition]));
				}
			} catch {
				/* fall back to the public surface below */
			}
			if (names === void 0) {
				const schemas = agent.ctx.tools.schemas();
				byTool = new Map(schemas.map((schema) => [schema.name, { description: schema.description, parameters: schema.parameters }]));
				names = schemas.map((schema) => schema.name).filter((name) => name !== RESERVED_TRANSPORT);
			}
			for (const name of names) {
				if (name === RESERVED_TRANSPORT) continue;
				const previous = catalog.get(name);
				if (previous !== void 0 && previous.description !== "") continue;
				const definition = byTool.get(name);
				const description = typeof definition?.description === "string" ? definition.description : "";
				if (description !== "") catalog.set(name, {
					description,
					parameters: definition?.parameters !== null && typeof definition?.parameters === "object" ? definition.parameters : null,
				});
				else if (previous === void 0) catalog.set(name, { description: "", parameters: null });
			}
		} catch {
			/* agent mid-teardown */
		}
	};

	/*
	 * Cache rule: a restriction changes the model-facing tool array, which is
	 * part of the request prefix — applying it to a LIVE agent invalidates the
	 * provider prefix cache from the first changed schema token. So the deny
	 * list is snapshotted at agent CREATION only, plus two deliberate
	 * exceptions that only ever RESTORE an existing restriction (identical
	 * surface ⇒ no cache cost): preset switches (`tools/change` from the
	 * preset registry's recompose) and plugin (re)mounts, whose fiber teardown
	 * would otherwise leave live agents unrestricted until a new session.
	 */
	const applyToAgent = (agent) => {
		if (agent?.ctx?.tools === void 0) return;
		snapshotCatalog(agent);
		const presetId = presetOf(agent);
		const disabled = disabledFor(presetId);
		const known = restrictableNames(agent);
		const deny = [...disabled].filter((tool) => known.has(tool)).sort();
		const previous = disposers.get(agent);
		const previousDeny = appliedDeny.get(agent);
		const unchanged = previous !== void 0 && previousDeny !== void 0 && previousDeny.length === deny.length && previousDeny.every((name, index) => name === deny[index]);
		if (unchanged) return;
		suppressing = true;
		try {
			if (previous !== void 0) {
				disposers.delete(agent);
				appliedDeny.delete(agent);
				try {
					previous();
				} catch {
					/* the agent scope may have disposed it first */
				}
			}
			if (deny.length > 0) {
				const disposer = agent.ctx.tools.restrict({ deny });
				disposers.set(agent, disposer);
				appliedDeny.set(agent, deny);
			}
		} catch (error) {
			ctx.logger.warn(`tool-manager: restrict failed for agent ${String(agent?.id)}: ${String(error?.message ?? error)}`);
		} finally {
			suppressing = false;
		}
	};

	ctx.on("agent/created", ({ agent }) => {
		/* A throw here would fail the agent's creation outright (serial dispatch). */
		try {
			applyToAgent(agent);
		} catch (error) {
			ctx.logger.warn(`tool-manager: agent/created apply failed: ${String(error?.stack ?? error)}`);
		}
	});
	ctx.on("agent/disposed", ({ agent }) => {
		disposers.delete(agent);
		appliedDeny.delete(agent);
	});
	/* Preset switches (and preset-plane tool changes) re-resolve the deny list. */
	ctx.on("tools/change", () => {
		if (suppressing) return;
		for (const agent of ctx.agents.list()) applyToAgent(agent);
	});
	ctx.effect(() => () => {
		for (const dispose of disposers.values()) {
			try {
				dispose();
			} catch {
				/* the agent scope may have disposed it first */
			}
		}
		disposers.clear();
		appliedDeny.clear();
	}, "tool-manager: restrictions");

	const json = (res, status, body) => {
		const payload = JSON.stringify(body);
		res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
		res.end(payload);
	};

	const readBody = (req, res) => new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 1 << 20) {
				/* Answer before tearing the socket down so the client sees 413, not a reset. */
				try {
					res.writeHead(413, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ ok: false, code: "error.proto.bodyTooLarge", error: "request body too large" }));
				} catch { /* socket already gone */ }
				req.destroy();
				reject(Object.assign(new Error("request body too large"), { code: "error.proto.bodyTooLarge" }));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});

	const readJsonBody = async (req, res) => {
		const raw = await readBody(req, res);
		try {
			return JSON.parse(raw || "{}");
		} catch {
			json(res, 400, { ok: false, code: "error.proto.invalidBody", error: "invalid JSON body" });
			return void 0;
		}
	};

	/*
	 * Mutation routes are plain HTTP (no GUI session token), so treat a
	 * cross-origin POST as forgery: a same-origin fetch has Origin host ==
	 * Host header, direct clients (curl) send no Origin at all.
	 */
	const sameOrigin = (req) => {
		const origin = req.headers.origin;
		if (origin === void 0) return true;
		try {
			return new URL(origin).host === String(req.headers.host ?? "");
		} catch {
			return false;
		}
	};

	/** Reserved JS-object keys must never become preset keys (Map is safe, but resync/JSON paths are not). */
	const safePresetKey = (value) => typeof value === "string" && value !== "" && value !== "__proto__" && value !== "constructor" && value !== "prototype" ? value : void 0;

	/**
	 * Preset roster for the settings UI. Runs against a hard deadline: the
	 * registry's list() audits every preset and can wait on the loader tree,
	 * so a wedged apply anywhere would otherwise hang this route — and the
	 * settings page re-GETs on every click. A timed-out roster yields no
	 * chips rather than a dead page.
	 */
	const listPresets = async () => {
		try {
			const registry = ctx.get("agentPresets");
			if (registry?.list === void 0) return [];
			/* registry.list() carries no default marker; resolve() names the default preset. */
			const defaultId = await (async () => {
				try {
					const resolved = await withTimeout(Promise.resolve(registry.resolve?.()), 800, void 0);
					return typeof resolved?.id === "string" ? resolved.id : void 0;
				} catch {
					return void 0;
				}
			})();
			const rows = await withTimeout(Promise.resolve(registry.list()), PRESETS_TIMEOUT_MS, []);
			return rows.map((row) => ({
				id: row.id,
				name: typeof row.name === "string" && row.name !== "" ? row.name : row.id,
				isDefault: row.isDefault === true || (defaultId !== void 0 && row.id === defaultId),
				...(typeof row.broken === "string" ? { broken: row.broken } : {}),
			}));
		} catch {
			return [];
		}
	};

	/**
	 * One preset's BASELINE tool set: what the preset enables by default,
	 * read straight from the preset's own retained scope (an isolated lease,
	 * `acquireScope`) so no live session is required and this plugin's own
	 * deny restrictions (registered on agent scopes) cannot pollute it.
	 * Preset rows marked `disabled` simply never register their tools, so
	 * they are absent from the baseline by construction. The lease's
	 * try/finally lives inside the inner promise, so a timeout abandonment
	 * still disposes it when the lookup eventually settles.
	 */
	const baselineFor = (presetId) => {
		const lookup = async () => {
			const registry = ctx.get("agentPresets");
			if (registry?.acquireScope === void 0) {
				return { names: [], byName: new Map(), broken: "agent preset registry unavailable" };
			}
			try {
				const lease = await registry.acquireScope(presetId);
				try {
					const view = ctx.tools.view(lease.key);
					const names = [];
					const byName = new Map();
					for (const [name, definition] of view.visible) {
						if (name === RESERVED_TRANSPORT) continue;
						names.push(name);
						byName.set(name, {
							description: typeof definition?.description === "string" ? definition.description : "",
							parameters: definition?.parameters !== null && typeof definition?.parameters === "object" ? definition.parameters : null,
						});
					}
					return { names, byName, broken: void 0 };
				} finally {
					await lease[Symbol.asyncDispose]?.();
				}
			} catch (error) {
				return { names: [], byName: new Map(), broken: String(error?.message ?? error) };
			}
		};
		const running = lookup();
		running.catch(() => {});
		return withTimeout(running, BASELINE_TIMEOUT_MS, { names: [], byName: new Map(), broken: "preset lookup timed out" });
	};

	const registerRoutes = () => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler: async (req, res) => {
			const url = new URL(req.url, "http://dsh.invalid");
			const path = url.pathname.replace(/\/+$/, "");
			try {
				if (req.method === "GET" && (path === `${API_PREFIX}/catalog` || path === API_PREFIX)) {
					const wanted = url.searchParams.get("preset");
					if (typeof wanted !== "string" || wanted === "") {
						json(res, 400, { ok: false, code: "error.proto.presetRequired", error: "`preset` query is required" });
						return;
					}
					/*
					 * Preset view: the baseline IS the list — exactly the tools
					 * the preset enables by default; `disabled` layers the
					 * preset's toggle overrides on top of it.
					 */
					const presets = await listPresets();
					const baseline = await baselineFor(wanted);
					const overrides = WRITE_STORE.presets.get(wanted) ?? [];
					const overrideSet = new Set(overrides);
					/* Merge first: even a broken/timeout lookup may know names the /set gate should accept. */
					for (const [name, info] of baseline.byName) {
						const previous = catalog.get(name);
						if (previous === void 0 || previous.description === "") catalog.set(name, { description: info.description, parameters: info.parameters });
					}
					if (baseline.broken !== void 0) {
						json(res, 200, {
							ok: true,
							data: {
								ready: false,
								broken: baseline.broken,
								presets,
								overrides: [...overrideSet].sort(),
								tools: [],
							},
						});
						return;
					}
					for (const [name, info] of baseline.byName) {
						const previous = catalog.get(name);
						if (previous === void 0 || previous.description === "") catalog.set(name, { description: info.description, parameters: info.parameters });
					}
					refreshSourceByScope();
					const tools = baseline.names.map((name) => ({
						name,
						description: baseline.byName.get(name)?.description ?? "",
						parameters: baseline.byName.get(name)?.parameters ?? null,
						disabled: overrideSet.has(name),
						sourcePlugin: sourceFor(name),
					})).sort((a, b) => a.name.localeCompare(b.name));
					/*
					 * Token accounting with the real tokenizer. The first request
					 * after boot pays a one-time tokenizer load (download + parse);
					 * until it lands the catalog answers status "loading" and the
					 * settings page re-polls, so the wait never blocks the toggle
					 * surface. `enabledTotal` counts the WHOLE active tool block
					 * (per-tool lines plus the template's instruction header) on
					 * the concatenated text — the exact recurring prefix cost,
					 * seams included.
					 */
					const tokenState = await withTimeout(tokenizer.ready(), 2500, { state: "loading", label: tokenizer.labelFor() });
					const tokensReady = tokenState.state === "ready";
					const enabled = tools.filter((tool) => !tool.disabled);
					json(res, 200, {
						ok: true,
						data: {
							ready: true,
							presets,
							overrides: [...overrideSet].sort(),
							tools: tools.map((tool) => ({
								...tool,
								tokens: tokensReady ? tokenizer.toolTokens(tool) : null,
							})),
							tokenStats: {
								status: tokensReady ? "ready" : tokenState.state,
								tokenizer: tokenState.label,
								...(tokenState.error !== undefined ? { error: tokenState.error } : {}),
								enabledTotal: tokensReady ? tokenizer.toolsBlockTotal(enabled) : null,
							},
						},
					});
					return;
				}
				if (req.method === "POST" && path === `${API_PREFIX}/reset`) {
					if (!sameOrigin(req)) {
						json(res, 403, { ok: false, code: "error.proto.crossOrigin", error: "cross-origin request rejected" });
						return;
					}
					const body = await readJsonBody(req, res);
					if (body === void 0) return;
					const presetId = safePresetKey(body?.preset);
					if (presetId === void 0) {
						json(res, 400, { ok: false, code: "error.proto.presetRequired", error: "`preset` is required" });
						return;
					}
					/*
					 * Mutate the store now (authoritative view), respond, then
					 * persist a single-key partial patch: deep-merge keeps every
					 * sibling preset untouched.
					 */
					WRITE_STORE.presets.set(presetId, []);
					json(res, 200, { ok: true, data: { preset: presetId } });
					persist(presetId, () => ({ presets: { [presetId]: [...WRITE_STORE.presets.get(presetId) ?? []].sort() } }));
					return;
				}
				if (req.method === "POST" && path === `${API_PREFIX}/bulk`) {
					if (!sameOrigin(req)) {
						json(res, 403, { ok: false, code: "error.proto.crossOrigin", error: "cross-origin request rejected" });
						return;
					}
					const body = await readJsonBody(req, res);
					if (body === void 0) return;
					const presetId = safePresetKey(body?.preset);
					const disabled = body?.disabled;
					if (presetId === void 0) {
						json(res, 400, { ok: false, code: "error.proto.presetRequired", error: "`preset` is required" });
						return;
					}
					if (typeof disabled !== "boolean") {
						json(res, 400, { ok: false, code: "error.proto.invalidValue", error: "`disabled` must be a boolean" });
						return;
					}
					if (disabled === false) {
						/* Enable all ≡ reset: an empty list denies nothing. */
						WRITE_STORE.presets.set(presetId, []);
						json(res, 200, { ok: true, data: { preset: presetId, disabled: false, count: 0 } });
						persist(presetId, () => ({ presets: { [presetId]: [] } }));
						return;
					}
					/*
					 * Disable all = deny a SNAPSHOT of the preset's current
					 * baseline. Deliberately not a wildcard: tools the preset
					 * gains later stay enabled (and visible), so nothing is
					 * blocked invisibly; the user re-runs the action if wanted.
					 */
					const baseline = await baselineFor(presetId);
					if (baseline.broken !== void 0) {
						json(res, 502, { ok: false, code: "error.proto.baselineUnavailable", error: baseline.broken });
						return;
					}
					const names = baseline.names.slice().sort();
					if (names.length === 0 && (WRITE_STORE.presets.get(presetId)?.length ?? 0) > 0) {
						/* A zero-tool surface must not silently wipe existing overrides. */
						json(res, 502, { ok: false, code: "error.proto.emptyBaseline", error: "preset exposes no tools; refusing to wipe existing overrides" });
						return;
					}
					WRITE_STORE.presets.set(presetId, names);
					json(res, 200, { ok: true, data: { preset: presetId, disabled: true, count: names.length } });
					persist(presetId, () => ({ presets: { [presetId]: [...WRITE_STORE.presets.get(presetId) ?? []].sort() } }));
					return;
				}
				if (req.method === "POST" && path === `${API_PREFIX}/set`) {
					if (!sameOrigin(req)) {
						json(res, 403, { ok: false, code: "error.proto.crossOrigin", error: "cross-origin request rejected" });
						return;
					}
					const body = await readJsonBody(req, res);
					if (body === void 0) return;
					const tool = body?.name;
					const next = body?.disabled;
					const presetId = safePresetKey(body?.preset);
					if (typeof tool !== "string" || tool.length === 0 || tool === RESERVED_TRANSPORT) {
						json(res, 400, { ok: false, code: "error.proto.invalidName", error: "invalid tool name" });
						return;
					}
					if (typeof next !== "boolean") {
						json(res, 400, { ok: false, code: "error.proto.invalidValue", error: "`disabled` must be a boolean" });
						return;
					}
					if (presetId === void 0) {
						json(res, 400, { ok: false, code: "error.proto.presetRequired", error: "`preset` is required" });
						return;
					}
					if (!catalog.has(tool)) {
						json(res, 404, { ok: false, code: "error.proto.unknownTool", error: `unknown tool: ${tool}` });
						return;
					}
					/*
					 * Mutate the store (authoritative view), respond first, then
					 * serialize the persist as a single-key partial patch.
					 */
					const list = new Set(WRITE_STORE.presets.get(presetId) ?? []);
					if (next) list.add(tool);
					else list.delete(tool);
					WRITE_STORE.presets.set(presetId, [...list].sort());
					json(res, 200, { ok: true, data: { name: tool, disabled: next, preset: presetId } });
					persist(presetId, () => ({ presets: { [presetId]: [...WRITE_STORE.presets.get(presetId) ?? []].sort() } }));
					return;
				}
				json(res, 404, { ok: false, code: "error.proto.unknownAction", error: `unknown action: ${path}` });
			} catch (error) {
				json(res, 500, { ok: false, code: "error.proto.internal", error: String(error?.message ?? error) });
			}
		},
	});

	ctx.effect(registerRoutes, "tool-manager: API routes");

	/*
	 * Mount-time freshness + restore: if no write of ours is queued, re-sync
	 * the store from the committed config — this covers source-HMR and
	 * enable/disable remounts, where the module (and its store) survived but
	 * the committed file may have changed. Then re-apply the CURRENT deny to
	 * live agents: the previous instance's fiber teardown disposed its
	 * restriction disposers, and identical deny ⇒ identical request prefix ⇒
	 * no cache cost.
	 */
	if (WRITE_STORE.pending === 0) syncStoreFromConfig();
	for (const agent of ctx.agents.list()) {
		try {
			applyToAgent(agent);
		} catch {
			/* agent mid-teardown */
		}
	}
}

export { apply };
