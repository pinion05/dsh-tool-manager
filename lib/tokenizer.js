/**
 * @npmc_5/dsh-tool-manager — real-tokenizer context accounting.
 *
 * Counts the tokens a tool definition actually contributes to the model
 * context, using the model family's OWN tokenizer (HF `tokenizer.json`,
 * byte-level BPE in the GPT-2/tiktoken lineage) instead of a chars/4
 * heuristic:
 *
 *  - GLM-5.x / GLM-4.x ship a GPT-2-style byte-level BPE (Ġ/Ċ markers,
 *    `ignore_merges: true`) with the cl100k pre-tokenizer regex, so the
 *    encoding algorithm is the standard tiktoken one over GLM's vocab +
 *    merge ranks. Counts were fuzz-verified 1:1 against the official Rust
 *    `tokenizers` crate on the GLM-5.3 vocab.
 *  - The counted text is what the serving stack actually puts in the
 *    prompt: the GLM-5.3 chat template's `tool_to_json` macro unwraps the
 *    OpenAI function object, drops `strict`/`defer_loading`, and emits
 *    `{"name": …, "description": …, "parameters": …}` per line inside
 *    <tools></tools>. Verified end-to-end against the live glm-5.3 API:
 *    template-rendered prompt tokens matched usage.prompt_tokens exactly
 *    (0/1/2-tool requests). The compact wire JSON DSH sends is counted as
 *    a secondary figure.
 *
 * The tokenizer.json source order is: `tokenizerPath` (absolute local
 * path), then a download cache under the DSH cache dir, then
 * `tokenizerUrl` (default zai-org/GLM-5.3). Loading is lazy (first
 * catalog request), the parsed ranks live at module scope so plugin
 * remounts never re-pay the parse, and per-text counts are memoized.
 */

const process_ = globalThis.process;
const nodeFs = () => process_.getBuiltinModule("node:fs");
const nodePath = () => process_.getBuiltinModule("node:path");
const nodeOs = () => process_.getBuiltinModule("node:os");

export const DEFAULT_TOKENIZER_URL = "https://huggingface.co/zai-org/GLM-5.3/resolve/main/tokenizer.json";
export const TOKENIZER_LABEL = "GLM-5.3 byte-level BPE";

const CACHE_DIR_NAME = "tool-manager";
const CACHE_FILE_NAME = "tokenizer.json";

/**
 * JS translation of the GLM pre-tokenizer Split regex. The scoped inline
 * flag `(?i:'s|'t|…)` has no JS equivalent, so that arm is expanded by
 * hand; everything else ports 1:1 onto the `u` flag (fancy-regex and JS
 * agree on \p{L}/\p{N} and the lookahead).
 */
const PRETOKENIZE_RE = new RegExp(
	"'(?:[sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])" +
	"|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+" +
	"|\\p{N}{1,3}" +
	"| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*" +
	"|\\s*[\\r\\n]+" +
	"|\\s+(?!\\S)" +
	"|\\s+",
	"gu",
);

/** GPT-2 byte↔unicode table: printable Latin-1 maps to itself, the rest to 256+n. */
const buildByteTable = () => {
	const table = new Array(256);
	let n = 0;
	for (let byte = 0; byte < 256; byte++) {
		if ((byte >= 33 && byte <= 126) || (byte >= 161 && byte <= 172) || (byte >= 174 && byte <= 255)) table[byte] = byte;
		else table[byte] = 256 + n++;
	}
	return table;
};
const BYTE_TABLE = buildByteTable();
const BYTE_CHARS = BYTE_TABLE.map((code) => String.fromCodePoint(code));
/* Byte-level pieces only ever contain code points ≥ 33, so \u0000 is a safe pair separator. */
const PAIR_SEP = "\u0000";

class ByteLevelBPE {
	/** @param vocab Map<string, number> @param merges Map<string, number> keyed "a\u0000b" */
	constructor(vocab, merges, addedTokens) {
		this.vocab = vocab;
		this.merges = merges;
		this.addedTokens = addedTokens;
		this.addedSplit = addedTokens.length > 0
			? new RegExp(addedTokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gu")
			: null;
	}

	/** Token count of arbitrary text (added/special tokens count as one each). */
	count(text) {
		if (typeof text !== "string" || text.length === 0) return 0;
		let total = 0;
		const segments = this.addedSplit !== null ? text.split(this.addedSplit) : [text];
		if (this.addedSplit !== null) {
			/* split() keeps the non-matching segments; matches contribute one token each. */
			const matches = text.match(this.addedSplit);
			total += matches !== null ? matches.length : 0;
		}
		for (const segment of segments) total += this.countPlain(segment);
		return total;
	}

	/** Plain (no special tokens) text: pre-tokenize, then BPE each piece. */
	countPlain(text) {
		if (text.length === 0) return 0;
		let total = 0;
		PRETOKENIZE_RE.lastIndex = 0;
		for (const match of text.matchAll(PRETOKENIZE_RE)) total += this.countPiece(match[0]);
		return total;
	}

	countPiece(piece) {
		const bytes = Buffer.from(piece, "utf8");
		let pieceString = "";
		for (const byte of bytes) pieceString += BYTE_CHARS[byte];
		/* ignore_merges: whole-word vocab hit short-circuits the merge loop. */
		if (this.vocab.has(pieceString)) return 1;
		/* Byte-level BPE guarantees every single byte char is in vocab. */
		let parts = pieceString.split("");
		while (parts.length > 1) {
			let bestRank = Infinity;
			let bestFirst = "";
			let bestSecond = "";
			for (let index = 0; index < parts.length - 1; index++) {
				const rank = this.merges.get(parts[index] + PAIR_SEP + parts[index + 1]);
				if (rank !== undefined && rank < bestRank) {
					bestRank = rank;
					bestFirst = parts[index];
					bestSecond = parts[index + 1];
				}
			}
			if (bestRank === Infinity) break;
			/* Merge ALL non-overlapping occurrences of the winning pair, left to right. */
			const merged = bestFirst + bestSecond;
			const next = [];
			for (let index = 0; index < parts.length;) {
				if (index < parts.length - 1 && parts[index] === bestFirst && parts[index + 1] === bestSecond) {
					next.push(merged);
					index += 2;
				} else {
					next.push(parts[index]);
					index += 1;
				}
			}
			parts = next;
		}
		return parts.length;
	}
}

/** Parse a HF tokenizer.json into a ready encoder. Throws on unexpected shapes. */
const buildFromTokenizerJson = (document) => {
	const model = document?.model;
	if (model?.type !== "BPE" || model.vocab == null || !Array.isArray(model.merges)) {
		throw new Error("tokenizer.json is not a byte-level BPE document");
	}
	const vocab = new Map(Object.entries(model.vocab));
	const merges = new Map();
	for (let rank = 0; rank < model.merges.length; rank++) {
		const pair = model.merges[rank];
		if (Array.isArray(pair) && pair.length === 2) merges.set(pair[0] + PAIR_SEP + pair[1], rank);
	}
	const addedTokens = (Array.isArray(document.added_tokens) ? document.added_tokens : [])
		.filter((entry) => typeof entry?.content === "string" && entry.content.length > 1)
		.map((entry) => entry.content)
		.sort((a, b) => b.length - a.length);
	return new ByteLevelBPE(vocab, merges, addedTokens);
};

/** Python json.dumps(value, ensure_ascii=False) — ", " / ": " separators. */
export const pythonDumps = (value) => {
	if (value === null || value === undefined) return "null";
	switch (typeof value) {
		case "string": return JSON.stringify(value);
		case "number": return Number.isFinite(value) ? String(value) : "null";
		case "boolean": return String(value);
		case "object":
			if (Array.isArray(value)) return `[${value.map(pythonDumps).join(", ")}]`;
			return `{${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}: ${pythonDumps(entry)}`).join(", ")}}`;
		default: return "null";
	}
};

/**
 * The OpenAI-compat wire object pi-ai sends per tool (openai-completions
 * adapter: type/function wrapper, `strict: false` whenever the route's
 * compat does not disable strict mode — the GLM coding routes keep it on).
 */
export const openAiToolObject = (tool) => ({
	type: "function",
	function: {
		name: tool.name,
		description: tool.description ?? "",
		parameters: tool.parameters ?? {},
		strict: false,
	},
});

/**
 * Per-tool prompt text as GLM-5.x serving actually renders it. The GLM-5.3
 * chat template unwraps the OpenAI `function` object, DROPS the `strict`
 * and `defer_loading` keys, and emits `{"name": …, "description": …,
 * "parameters": …}` with Python json.dumps spacing (", " / ": ") followed
 * by a newline — one line per tool inside <tools></tools>. Verified
 * end-to-end against the live glm-5.3 API: rendered prompt tokens matched
 * usage.prompt_tokens exactly for 0/1/2-tool requests.
 */
export const glmToolLine = (tool) => {
	const entries = Object.entries({
		name: tool.name,
		description: tool.description ?? "",
		parameters: tool.parameters ?? {},
	}).filter(([key]) => key !== "strict" && key !== "defer_loading");
	return `{${entries.map(([key, value]) => `${JSON.stringify(key)}: ${pythonDumps(value)}`).join(", ")}}\n`;
};

/**
 * Fixed prompt text around the tool list when at least one tool is active,
 * mirroring zai-org/GLM-5.3 chat_template.jinja rendered with the serving
 * jinja environment (trim_blocks + lstrip_blocks): the tools block lives in
 * a dedicated system turn and the per-tool JSON lines carry their own
 * trailing newline (header ends with "<tools>\n"; footer starts at
 * "</tools>"). Measured with the live API: header+footer = 95 tokens on
 * glm-5.3, identical to this construction.
 */
export const TOOLS_TEMPLATE_HEADER =
	"<|system|>\n# Tools\n\nYou may call one or more functions to assist with the user query.\n\n" +
	"You are provided with function signatures within <tools></tools> XML tags:\n<tools>\n";
export const TOOLS_TEMPLATE_FOOTER =
	"</tools>\n\nFor each function call, output the function name and arguments within the following XML format:\n" +
	"<tool_call>{function-name}<arg_key>{arg-key-1}</arg_key><arg_value>{arg-value-1}</arg_value>" +
	"<arg_key>{arg-key-2}</arg_key><arg_value>{arg-value-2}</arg_value>...</tool_call>";

const cacheDir = () => {
	const home = process_.env.DSH_HOME ?? nodeOs().homedir();
	return nodePath().join(home, "cache", CACHE_DIR_NAME);
};

/** Module-scope memo: survives plugin remounts, so the 20MB parse is paid once per host process. */
const MEMO = { encoder: null, label: "", error: "", promise: null, counts: new Map() };
const COUNT_CACHE_LIMIT = 2000;

class TokenizerService {
	constructor(options) {
		this.logger = options.logger;
		this.sourcePath = typeof options.sourcePath === "string" && options.sourcePath !== "" ? options.sourcePath : "";
		this.url = typeof options.url === "string" && options.url !== "" ? options.url : DEFAULT_TOKENIZER_URL;
		this.cachePath = nodePath().join(cacheDir(), CACHE_FILE_NAME);
	}

	status() {
		if (MEMO.encoder !== null) return { state: "ready", label: MEMO.label };
		if (MEMO.promise !== null) return { state: "loading", label: this.labelFor() };
		if (MEMO.error !== "") return { state: "unavailable", label: this.labelFor(), error: MEMO.error };
		return { state: "idle", label: this.labelFor() };
	}

	labelFor() {
		if (this.sourcePath !== "") return nodePath().basename(this.sourcePath);
		const url = this.url;
		const match = /\/([^/]+)\/resolve\//.exec(url);
		return match !== null ? match[1] : url;
	}

	/** Load once per process; concurrent callers share one promise. Resolves to a status. */
	async ready() {
		if (MEMO.encoder !== null) return { state: "ready", label: MEMO.label };
		if (MEMO.promise === null) {
			MEMO.promise = (async () => {
				try {
					const document = await this.loadDocument();
					const encoder = buildFromTokenizerJson(document);
					MEMO.encoder = encoder;
					MEMO.label = this.labelFor();
					MEMO.error = "";
				} catch (error) {
					MEMO.error = String(error?.message ?? error);
					this.logger?.warn(`tool-manager: tokenizer unavailable: ${MEMO.error}`);
				} finally {
					MEMO.promise = null;
				}
			})();
		}
		await MEMO.promise;
		return this.status();
	}

	async loadDocument() {
		const fs = nodeFs();
		/* 1. explicit local path */
		if (this.sourcePath !== "") return JSON.parse(await fs.promises.readFile(this.sourcePath, "utf8"));
		/* 2. download cache */
		try {
			return await this.parseCache(fs);
		} catch { /* cache missing or corrupt — (re)download below */ }
		/* 3. download + fill the cache */
		const document = await this.download();
		try {
			await fs.promises.mkdir(nodePath().dirname(this.cachePath), { recursive: true });
			const temp = `${this.cachePath}.tmp-${Date.now()}`;
			await fs.promises.writeFile(temp, JSON.stringify(document), "utf8");
			await fs.promises.rename(temp, this.cachePath);
		} catch (error) {
			this.logger?.warn(`tool-manager: tokenizer cache write failed: ${String(error?.message ?? error)}`);
		}
		return document;
	}

	async parseCache(fs) {
		const raw = await fs.promises.readFile(this.cachePath, "utf8");
		const document = JSON.parse(raw);
		if (document?.model?.type !== "BPE" || document?.model?.vocab == null) throw new Error("cache is not a tokenizer.json");
		return document;
	}

	async download() {
		if (typeof fetch !== "function") throw new Error("no fetch available to download the tokenizer");
		const response = await fetch(this.url, { redirect: "follow" });
		if (!response.ok) throw new Error(`tokenizer download failed: HTTP ${String(response.status)}`);
		return await response.json();
	}

	/** Memoized token count; null while the tokenizer is not ready. */
	count(text) {
		if (MEMO.encoder === null) return null;
		const cached = MEMO.counts.get(text);
		if (cached !== undefined) {
			MEMO.counts.delete(text);
			MEMO.counts.set(text, cached);
			return cached;
		}
		const count = MEMO.encoder.count(text);
		if (MEMO.counts.size >= COUNT_CACHE_LIMIT) {
			const oldest = MEMO.counts.keys().next().value;
			MEMO.counts.delete(oldest);
		}
		MEMO.counts.set(text, count);
		return count;
	}

	/** Context figures for one tool; nulls while not ready. */
	toolTokens(tool) {
		if (MEMO.encoder === null) return null;
		/* Primary: the per-tool line as GLM serving renders it into the prompt. */
		const promptText = glmToolLine(tool);
		/* Secondary: the compact JSON DSH actually sends on the wire. */
		const wireText = JSON.stringify(openAiToolObject(tool));
		return {
			prompt: this.count(promptText),
			wire: this.count(wireText),
		};
	}

	/** Fixed <tools> header+footer tokens around an active tool list; null while not ready. */
	headerTokens() {
		if (MEMO.encoder === null) return null;
		return this.count(TOOLS_TEMPLATE_HEADER) + this.count(TOOLS_TEMPLATE_FOOTER);
	}

	/**
	 * Exact tokens of the WHOLE active tool block — instruction header, every
	 * per-tool line, and the footer — counted on the concatenated text so
	 * tokens straddling the seams are attributed once and only once. This is
	 * the number that matches the provider's usage.prompt_tokens delta.
	 */
	toolsBlockTotal(tools) {
		if (MEMO.encoder === null) return null;
		if (tools.length === 0) return 0;
		const lines = tools.map((tool) => glmToolLine(tool)).join("");
		return this.count(TOOLS_TEMPLATE_HEADER + lines + TOOLS_TEMPLATE_FOOTER);
	}
}

export { TokenizerService };
