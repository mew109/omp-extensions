/**
 * OSC 8 hyperlink helpers moved between host surfaces across omp minors
 * (18.2.x: @oh-my-pi/pi-tui/render; <=18.1.x: @oh-my-pi/pi-coding-agent/tui).
 * We import the host module so each version keeps its own gate; plain text
 * when neither surface resolves.
 */
export interface HyperlinkHelpers {
	file(path: string, text: string): string;
	url(url: string, text: string): string;
}

export type ModuleLoader = (spec: string) => Promise<unknown>;

const plainHelpers: HyperlinkHelpers = {
	file: (_path, text) => text,
	url: (_path, text) => text,
};

let impl: HyperlinkHelpers = plainHelpers;

const defaultLoad: ModuleLoader = (spec) => import(spec);

const CANDIDATES = ["./hyperlink-render.ts", "./hyperlink-tui.ts"] as const;

export function initHyperlinks(load: ModuleLoader = defaultLoad): Promise<void> {
	impl = plainHelpers;
	return (async () => {
		for (const spec of CANDIDATES) {
			try {
				const mod = (await load(spec)) as Record<string, unknown>;
				if (typeof mod.fileHyperlink === "function" && typeof mod.urlHyperlink === "function") {
					impl = {
						file: mod.fileHyperlink as HyperlinkHelpers["file"],
						url: mod.urlHyperlink as HyperlinkHelpers["url"],
					};
					return;
				}
			} catch {
				// surface missing on this omp: try the next one
			}
		}
	})();
}

export function fileHyperlink(path: string, text: string): string {
	return impl.file(path, text);
}

export function urlHyperlink(url: string, text: string): string {
	return impl.url(url, text);
}
