window.__ModuleLoader__.load({
	id: "@npmc_5/dsh-tools-toggle",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const { Switch, Input } = require("@deepseek-ai/dsh-client-ui-primitives");

		const NS = "tools-toggle";
		const API = "/api/npmc_5/tools-toggle";
		const CORE_TOOLS = new Set(["bash", "read", "write", "edit"]);
		const STYLE_ID = "dtt-style";

		const dictionaries = {
			ko: {
				"nav": "도구",
				"title": "도구 켜고 끄기",
				"intro": "끈 도구는 스키마·조회·실행 전부에서 숨겨집니다. 새 세션(및 새 서브에이전트)부터 적용 — 진행 중인 세션은 프리픽스 캐시 보호를 위해 그대로 유지됩니다.",
				"search": "도구 검색",
				"filter.disabled": "끈 것만 보기",
				"empty": "표시할 도구가 없습니다.",
				"notReady": "아직 구성할 도구 목록이 없습니다. 세션을 시작한 뒤 다시 열어주세요.",
				"loadFailed": "목록을 불러오지 못했습니다.",
				"retry": "다시 시도",
				"confirm.core": "{name} 은(는) 핵심 도구입니다. 끄면 대부분의 작업이 막힙니다. 계속할까요?",
				"error.action": "적용 실패: {error}",
				"count.disabled": "꺼진 도구 {count}개",
			},
			en: {
				"nav": "Tools",
				"title": "Tool toggles",
				"intro": "Turning a switch off hides that tool — schema, lookup, and execution alike. Takes effect for NEW sessions (and new subagents); live sessions keep their tool surface to protect the prefix cache.",
				"search": "Search tools",
				"filter.disabled": "Disabled only",
				"empty": "No tools to show.",
				"notReady": "No tool catalog yet. Start a session, then reopen this page.",
				"loadFailed": "Failed to load the tool list.",
				"retry": "Retry",
				"confirm.core": "{name} is a core tool. Disabling it blocks most work. Continue?",
				"error.action": "Failed to apply: {error}",
				"count.disabled": "{count} disabled",
			},
		};

		const api = (path, options) => fetch(baseHref() + API + path, options).then(async (response) => {
			const body = await response.json().catch(() => null);
			if (!response.ok || !body || body.ok === false) {
				throw new Error(body?.error ?? `HTTP ${String(response.status)}`);
			}
			return body.data;
		});

		const baseHref = () => {
			const base = document.querySelector("base[href]");
			if (base === null) return "";
			try {
				return new URL(base.getAttribute("href"), window.location.href).pathname.replace(/\/+$/, "");
			} catch {
				return "";
			}
		};

		const injectStyles = () => {
			if (document.getElementById(STYLE_ID) !== null || document.head === null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			/* Token vocabulary mirrors the native settings pages (ui-settings-subagent). */
			style.textContent = [
				".dtt-page{display:grid;gap:12px;min-width:0}",
				".dtt-intro{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8a8a8f)}",
				".dtt-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
				".dtt-toolbar .dtt-search{flex:1;min-width:180px}",
				".dtt-count{color:var(--dsw-alias-label-tertiary,#8a8a8f);font-size:11px;font-weight:500;white-space:nowrap}",
				".dtt-chip{border:.5px solid var(--dsw-alias-border-l3,#d4d4d8);background:0 0;color:var(--dsw-alias-label-secondary,#6b6b70);border-radius:999px;padding:3px 10px;font-size:12px;line-height:1.5;cursor:pointer}",
				".dtt-chip:hover{background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.05))}",
				".dtt-chip[aria-pressed=true]{color:var(--dsw-alias-brand-primary,#4c6ef5);border-color:var(--dsw-alias-brand-primary,#4c6ef5)}",
				".dtt-list{border:.5px solid var(--dsw-alias-border-l4,#e4e4e7);border-radius:var(--dsw-radius-lg,12px);gap:2px;min-width:0;margin:0;padding:4px;display:grid}",
				".dtt-row{grid-template-columns:auto minmax(0,1fr);align-items:center;gap:10px;min-width:0;padding:6px 10px;border-radius:var(--dsw-radius-md,8px);display:grid}",
				".dtt-row:hover{background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.05))}",
				".dtt-row-main{grid-template-columns:minmax(0,auto) minmax(0,1fr);align-items:baseline;gap:8px;min-width:0;display:grid}",
				".dtt-row-name{color:var(--dsw-alias-label-primary,#222226);font-size:13px;line-height:1.5;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);white-space:nowrap}",
				".dtt-row-desc{color:var(--dsw-alias-label-tertiary,#8a8a8f);font-size:11px;line-height:1.5;text-overflow:ellipsis;white-space:nowrap;display:block;overflow:hidden}",
				".dtt-row.is-off .dtt-row-name{color:var(--dsw-alias-label-tertiary,#8a8a8f)}",
				".dtt-empty{color:var(--dsw-alias-label-tertiary,#8a8a8f);justify-self:center;padding:20px 12px;font-size:12px;line-height:1.5;margin:0}",
				".dtt-error{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary,#ef7272)}",
				".dtt-error button{color:var(--dsw-alias-brand-primary,#4c6ef5);cursor:pointer;background:0 0;border:0;padding:0;margin-left:8px}",
			].join("\n");
			document.head.append(style);
		};

		function ToolsSection(props) {
			const t = props.t;
			const [state, setState] = React.useState({ loading: true, error: null, ready: true, tools: [] });
			const [query, setQuery] = React.useState("");
			const [onlyDisabled, setOnlyDisabled] = React.useState(false);
			const [actionError, setActionError] = React.useState(null);
			const pendingRef = React.useRef(new Set());
			const [pendingTools, setPendingTools] = React.useState(() => new Set());
			const revision = React.useRef(0);

			const load = React.useCallback(async () => {
				const current = ++revision.current;
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await api("/catalog", { cache: "no-store" });
					if (current === revision.current) setState({ loading: false, error: null, ready: data.ready !== false, tools: data.tools ?? [] });
				} catch (error) {
					if (current === revision.current) setState((previous) => ({ ...previous, loading: false, error: String(error?.message ?? error) }));
				}
			}, []);

			React.useEffect(() => {
				load();
			}, [load]);

			const toggle = async (tool) => {
				if (pendingRef.current.has(tool.name)) return;
				const intended = !tool.disabled;
				if (intended && CORE_TOOLS.has(tool.name) && !window.confirm(t("confirm.core", { name: tool.name }))) return;
				pendingRef.current.add(tool.name);
				setPendingTools(new Set(pendingRef.current));
				setActionError(null);
				setState((previous) => ({ ...previous, tools: previous.tools.map((row) => row.name === tool.name ? { ...row, disabled: intended } : row) }));
				try {
					await api("/set", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ name: tool.name, disabled: intended }),
					});
					/*
					 * The catalog GET waits for the serialized settings write, so this
					 * re-read returns the post-write truth and confirms the flip.
					 */
					await load();
				} catch (error) {
					setActionError(t("error.action", { error: String(error?.message ?? error) }));
					await load();
				} finally {
					pendingRef.current.delete(tool.name);
					setPendingTools(new Set(pendingRef.current));
				}
			};

			const needle = query.trim().toLowerCase();
			const rows = state.tools.filter((tool) => (!onlyDisabled || tool.disabled) && (needle === "" || tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle)));
			const disabledCount = state.tools.filter((tool) => tool.disabled).length;

			return React.createElement("div", { className: "dtt-page" },
				React.createElement("p", { className: "dtt-intro" }, t("intro")),
				React.createElement("div", { className: "dtt-toolbar" },
					React.createElement(Input, {
						type: "search",
						className: "dtt-search",
						placeholder: t("search"),
						"aria-label": t("search"),
						value: query,
						onChange: (event) => setQuery(event.target.value),
					}),
					React.createElement("button", {
						type: "button",
						className: "dtt-chip",
						"aria-pressed": String(onlyDisabled),
						onClick: () => setOnlyDisabled(!onlyDisabled),
					}, t("filter.disabled")),
					disabledCount > 0 ? React.createElement("span", { className: "dtt-count" }, t("count.disabled", { count: String(disabledCount) })) : null,
				),
				actionError !== null ? React.createElement("p", { className: "dtt-error", role: "alert" }, actionError) : null,
				state.error !== null ? React.createElement("p", { className: "dtt-error", role: "alert" }, `${t("loadFailed")} `, state.error, " ", React.createElement("button", { type: "button", onClick: load }, t("retry"))) : null,
				state.ready === false
					? React.createElement("p", { className: "dtt-empty" }, t("notReady"))
					: rows.length === 0
						? React.createElement("p", { className: "dtt-empty" }, state.loading && state.tools.length === 0 ? "…" : t("empty"))
						: React.createElement("div", { className: "dtt-list", role: "list" }, rows.map((tool) => React.createElement("div", { className: `dtt-row${tool.disabled ? " is-off" : ""}`, key: tool.name, role: "listitem" },
							React.createElement(Switch, {
								checked: !tool.disabled,
								label: tool.name,
								disabled: pendingTools.has(tool.name),
								onChange: () => toggle(tool),
							}),
							React.createElement("div", { className: "dtt-row-main" },
								React.createElement("span", { className: "dtt-row-name" }, tool.name),
								React.createElement("span", { className: "dtt-row-desc", title: tool.description }, tool.description),
							),
						))),
			);
		}

		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, dictionaries), "tools-toggle: dictionaries");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "tools-toggle",
				order: 60,
				label: () => t("nav"),
				inject: () => ({ t }),
			}, ToolsSection));
			injectStyles();
		}

		const inject = ["locale", "slots"];

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
