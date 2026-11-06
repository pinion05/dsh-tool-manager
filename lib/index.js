/**
 * @npmc_5/dsh-tools-toggle — host half.
 *
 * Hides inherited model tools from every agent scope by applying one deny
 * restriction per agent through `agent.ctx.tools.restrict({ deny })`:
 * hidden tools lose schema, lookup, and execution together (the weakest
 * mechanism that still removes them from the model's view), while scope-local
 * machinery (delegation structured output) and the reserved PTC `run_code`
 * transport stay exempt by construction.
 *
 * State lives in this plugin's Loader-entry config (`disabledTools`), written
 * only by the HTTP route below through the settings service, so the profile
 * patch remains the single source of truth and the change survives upgrades.
 */
import Schema from "@deepseek-ai/schemastery";

export const name = "tools-toggle";

export const inject = ["tools", "agents", "settings", "webServer"];

export const Config = Schema.object({
	/*
	 * `volatile`: the settings service only writes form fields marked volatile
	 * (live-editable without a remount); this field is owned entirely by this
	 * plugin's HTTP route through `settings.update`.
	 */
	disabledTools: Schema.array(Schema.string()).default([]).volatile().description("Inherited tool names hidden from every agent scope."),
});

const SETTINGS_NS = "tools-toggle";
const API_PREFIX = "/api/npmc_5/tools-toggle";
const RESERVED_TRANSPORT = "run_code";

/**
 * Volatile config fields arrive as live references (`{ get(): T }`, updated in
 * place by the runtime without a remount); plain arrays arrive as arrays.
 * @param value - raw `disabledTools` config value.
 * @returns the current string array.
 */
const readDisabled = (value) => {
	if (Array.isArray(value)) return value;
	if (value !== null && typeof value === "object" && typeof value.get === "function") {
		const inner = value.get();
		return Array.isArray(inner) ? inner : [];
	}
	return [];
};

function apply(ctx, config) {
	/** agent -> restriction disposer (also owned by the agent scope itself) */
	const disposers = new Map();
	/** tool name -> description, snapshotted before any restriction hides it */
	const catalog = new Map();

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

	/*
	 * Catalog from the INHERITED (restrictable) surface only: scope-local
	 * machinery (delegation structured output, …) is not toggleable and must
	 * not appear. Preset-plane tools can register after `agent/created`, so
	 * the GET route re-snapshots live agents before responding.
	 */
	const snapshotCatalog = (agent) => {
		try {
			let names;
			let byName;
			try {
				const view = agent.ctx.tools.view(agent);
				if (view && view.restrictableNames instanceof Set) {
					/* schemas() with no scope reads the GLOBAL view; the agent view carries the preset plane. */
					names = [...view.restrictableNames];
					byName = new Map([...view.visible.values()].map((definition) => [definition.name, definition.description]));
				}
			} catch {
				/* fall back to the public surface below */
			}
			if (names === void 0) {
				const schemas = agent.ctx.tools.schemas();
				byName = new Map(schemas.map((schema) => [schema.name, schema.description]));
				names = schemas.map((schema) => schema.name).filter((name) => name !== RESERVED_TRANSPORT);
			}
			for (const name of names) {
				if (name === RESERVED_TRANSPORT) continue;
				const previous = catalog.get(name);
				if (previous !== void 0 && previous !== "") continue;
				const description = byName.get(name);
				if (typeof description === "string" && description !== "") catalog.set(name, description);
				else if (previous === void 0) catalog.set(name, "");
			}
		} catch {
			/* agent mid-teardown */
		}
	};

	/*
	 * Cache rule: a restriction changes the model-facing tool array, which is
	 * part of the request prefix — applying it to a LIVE agent invalidates the
	 * provider prefix cache from the first changed schema token. So the deny
	 * list is snapshotted at agent CREATION only: new sessions (and new
	 * subagents, whose prefixes are fresh anyway) get the current list, and
	 * existing conversations keep their tool surface — and their cache — until
	 * they naturally end. A host restart resumes a session as a new agent, so
	 * a config changed between boots applies there (one unavoidable re-prefill).
	 */
	const currentDisabled = () => new Set(readDisabled(config.disabledTools));

	const applyToAgent = (agent) => {
		if (agent?.ctx?.tools === void 0) return;
		snapshotCatalog(agent);
		const disabled = currentDisabled();
		const known = restrictableNames(agent);
		const deny = [...disabled].filter((tool) => known.has(tool));
		if (deny.length === 0) return;
		try {
			disposers.set(agent, agent.ctx.tools.restrict({ deny }));
		} catch (error) {
			ctx.logger.warn(`tools-toggle: restrict failed for agent ${String(agent.id)}: ${String(error?.message ?? error)}`);
		}
	};

	/** Serializes settings writes so consecutive toggles never build on a stale base. */
	let writeChain = Promise.resolve();
	/** Read-your-writes: a GET must wait until every accepted write has landed. */
	const writesSettled = () => writeChain.catch(() => {});

	ctx.on("agent/created", ({ agent }) => applyToAgent(agent));
	ctx.on("agent/disposed", ({ agent }) => {
		disposers.delete(agent);
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
	}, "tools-toggle: restrictions");

	const json = (res, status, body) => {
		const payload = JSON.stringify(body);
		res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
		res.end(payload);
	};

	const readBody = (req) => new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 1 << 20) {
				reject(new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});

	const registerRoutes = () => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler: async (req, res) => {
			const path = new URL(req.url, "http://dsh.invalid").pathname.replace(/\/+$/, "");
			try {
				if (req.method === "GET" && (path === `${API_PREFIX}/catalog` || path === API_PREFIX)) {
					await writesSettled();
					const disabled = currentDisabled();
					for (const agent of ctx.agents.list()) snapshotCatalog(agent);
					json(res, 200, {
						ok: true,
						data: {
							ready: catalog.size > 0,
							tools: [...catalog.entries()].map(([name, description]) => ({ name, description, disabled: disabled.has(name) })).sort((a, b) => a.name.localeCompare(b.name)),
						},
					});
					return;
				}
				if (req.method === "POST" && path === `${API_PREFIX}/set`) {
					const body = JSON.parse(await readBody(req) || "{}");
					const tool = body?.name;
					const next = body?.disabled;
					if (typeof tool !== "string" || tool.length === 0 || tool === RESERVED_TRANSPORT) {
						json(res, 400, { ok: false, code: "error.proto.invalidName", error: "invalid tool name" });
						return;
					}
					if (typeof next !== "boolean") {
						json(res, 400, { ok: false, code: "error.proto.invalidValue", error: "`disabled` must be a boolean" });
						return;
					}
					if (!catalog.has(tool)) {
						json(res, 404, { ok: false, code: "error.proto.unknownTool", error: `unknown tool: ${tool}` });
						return;
					}
					/*
					 * Respond first, then serialize the write: rapid consecutive
					 * toggles must each re-read the volatile reference AFTER the
					 * previous settings write landed, or a stale base re-adds a
					 * just-removed tool. The write updates the volatile field in
					 * place (no fiber remount), so it is safe on this plugin's
					 * own promise chain; the client re-reads the catalog after.
					 */
					json(res, 200, { ok: true, data: { name: tool, disabled: next } });
					writeChain = writeChain.then(async () => {
						await new Promise((resolve) => setTimeout(resolve, 30));
						const current = new Set(readDisabled(config.disabledTools));
						if (next) current.add(tool);
						else current.delete(tool);
						await ctx.settings.update(SETTINGS_NS, { disabledTools: [...current].sort() });
					}).catch((error) => {
						console.error(`[tools-toggle] settings.update failed: ${String(error?.stack ?? error)}`);
					});
					return;
				}
				json(res, 404, { ok: false, code: "error.proto.unknownAction", error: `unknown action: ${path}` });
			} catch (error) {
				json(res, 500, { ok: false, code: "error.proto.internal", error: String(error?.message ?? error) });
			}
		},
	});

	ctx.effect(registerRoutes, "tools-toggle: API routes");
}

export { apply };
