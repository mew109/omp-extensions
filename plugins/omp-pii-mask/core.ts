/**
 * omp-pii-mask core: PII pattern list, mask/unmask engine, message
 * transformers, and settings parsing. Pure module — no omp imports.
 *
 * Ported from pi-pii-mask (https://github.com/TheRealStubbornDeveloper/pi-pii-mask,
 * author alfrancisgabriel, MIT). Modified for omp: the PHONE pattern is
 * a setting (default off) because it matches every 10-digit run.
 */

export interface PiiPattern {
	name: string;
	regex: RegExp;
}

export const PATTERNS: PiiPattern[] = [
	{ name: "EMAIL", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
	{ name: "PHONE", regex: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
	{ name: "SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
	{ name: "CC", regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
	{ name: "PRIVATE_IP", regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g },
	{ name: "API_KEY_SK", regex: /\b(sk-[a-zA-Z0-9]{20,}|sk-ant-[a-zA-Z0-9_-]{20,}|sk-or-v1-[a-zA-Z0-9_-]{20,})\b/g },
	{ name: "API_KEY_GH", regex: /\b(gh[pousr]_[a-zA-Z0-9]{36,})\b/g },
	{ name: "API_KEY_AI", regex: /\b(AIza[a-zA-Z0-9_-]{30,})\b/g },
	{ name: "API_KEY_CF", regex: /\b(cf(?:k|ut|at)_[a-zA-Z0-9_-]{41,})\b/g },
	{ name: "JWT", regex: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g },
	{ name: "AWS_KEY", regex: /\b(AKIA[A-Z0-9]{16})\b/g },
	{ name: "CONN_STR", regex: /(mongodb(?:\+srv)?:\/\/[^:]+:)[^@]+(@)/g },
	{ name: "CONN_STR", regex: /(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/g },
	{ name: "CONN_STR", regex: /(mysql:\/\/[^:]+:)[^@]+(@)/g },
];

export interface Redactor {
	mask(text: string): string;
	unmask(text: string): string;
	entries(): [string, string][];
}

export function createRedactor(patterns: PiiPattern[]): Redactor {
	const placeholderIndex = new Map<string, string>();
	const reverseIndex = new Map<string, string>();
	let nextId = 1;

	function mask(text: string): string {
		return patterns.reduce((acc, p) => {
			return acc.replace(p.regex, (match) => {
				if (reverseIndex.has(match)) return reverseIndex.get(match)!;
				const placeholder = `[${p.name}_${nextId++}]`;
				placeholderIndex.set(placeholder, match);
				reverseIndex.set(match, placeholder);
				return placeholder;
			});
		}, text);
	}

	function unmask(text: string): string {
		let result = text;
		for (const [placeholder, original] of placeholderIndex) {
			result = result.replaceAll(placeholder, original);
		}
		return result;
	}
	return {
		mask,
		unmask,
		entries: () => [...placeholderIndex],
	};
}

/** Local structural type replacing upstream's TextContent import. */
export type ContentBlock = { type: string; text?: string; thinking?: string };

export function maskContent<T extends ContentBlock>(blocks: T[], redactor: Redactor): T[] {
	return blocks.map((block) => {
		if ((block.type === "text" || block.type === "thinking") && typeof block.text === "string") {
			return { ...block, text: redactor.mask(block.text) };
		}
		return block;
	});
}


export function unmaskInPlace(obj: Record<string, unknown>, redactor: Redactor): void {
	for (const key of Object.keys(obj)) {
		const val = obj[key];
		if (typeof val === "string") {
			obj[key] = redactor.unmask(val);
		} else if (val && typeof val === "object") {
			unmaskInPlace(val as Record<string, unknown>, redactor);
		}
	}
}

export function unmaskContent<T extends ContentBlock>(blocks: T[], redactor: Redactor): T[] {
	return blocks.map((block) => {
		if (block.type === "text" && typeof block.text === "string") {
			return { ...block, text: redactor.unmask(block.text) };
		}
		if (block.type === "thinking" && typeof block.thinking === "string") {
			return { ...block, thinking: redactor.unmask(block.thinking) };
		}
		return block;
	});
}

export const PII_NOTICE =
	"\n\nPrivacy: Tokens like [EMAIL_1], [PHONE_2] etc. are PII placeholders. Use them verbatim in tool calls and responses — they will be automatically restored to real values before tool execution and in the output you see.";

export function formatMap(entries: [string, string][]): string {
	if (entries.length === 0) return "No PII values redacted this session.";
	return entries.map(([placeholder, original]) => `${placeholder} → ${original}`).join("\n");
}

export function maskMessages<T extends { role: string }>(messages: T[], redactor: Redactor): T[] {
	return messages.map((msg) => {
		const content = (msg as { content?: unknown }).content;
		if (msg.role === "user" || msg.role === "toolResult") {
			if (typeof content === "string") {
				return { ...msg, content: redactor.mask(content) };
			}
			return { ...msg, content: maskContent(content as ContentBlock[], redactor) };
		}
		if (msg.role === "assistant") {
			const blocks = (content as ContentBlock[]).map((block) => {
				if (block.type === "thinking" && typeof block.thinking === "string") {
					return { ...block, thinking: redactor.mask(block.thinking) };
				}
				return block;
			});
			return { ...msg, content: blocks };
		}
		return msg;
	});
}

export function piiSettings(raw: unknown, env: Record<string, string | undefined>): PiiSettings {
	const envPhone = parseBool(env[ENV_PHONE]);
	const rawPhone = typeof raw === "object" && raw !== null && "phone" in raw ? raw.phone : undefined;
	const yamlPhone = parseBool(rawPhone);
	return { phone: envPhone ?? yamlPhone ?? DEFAULT_SETTINGS.phone };
}

// Settings: env > YAML `phone` > default false.
export interface PiiSettings {
	phone: boolean;
}

export const DEFAULT_SETTINGS: PiiSettings = { phone: false };

export const ENV_PHONE = "PII_MASK_PHONE";

export function parseBool(v: unknown): boolean | undefined {
	if (typeof v === "boolean") return v;
	if (typeof v !== "string") return undefined;
	const s = v.trim().toLowerCase();
	if (["true", "1", "yes", "on"].includes(s)) return true;
	if (["false", "0", "no", "off"].includes(s)) return false;
	return undefined;
}
