export function abbreviateSessionName(name: string, maxColumns = 15): string {
	// Strip control chars, collapse whitespace runs, trim.
	const cleaned = name
		.replace(/\p{Cc}/gu, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!cleaned) return "";

	const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
	let out = "";
	let width = 0;
	let truncated = false;
	for (const { segment } of segmenter.segment(cleaned)) {
		const w = Bun.stringWidth(segment);
		if (width + w > maxColumns) {
			truncated = true;
			break;
		}
		out += segment;
		width += w;
	}
	return out.trimEnd() + (truncated ? "…" : "");
}

export function herdrSpawnTarget(
	env: Record<string, string | undefined> = process.env,
): { tabId: string; bin: string } | undefined {
	const tabId = env.HERDR_TAB_ID?.trim();
	if (!tabId) return undefined;
	return { tabId, bin: env.HERDR_BIN_PATH?.trim() || "herdr" };
}
