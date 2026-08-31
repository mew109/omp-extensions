import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { abbreviateSessionName, herdrSpawnTarget } from "./core";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const execFileAsync = promisify(execFile);

const RETRY_DELAYS_MS = [2000, 6000, 12000];

export default function ompHerdrTabExtension(pi: ExtensionAPI) {
	const target = herdrSpawnTarget();
	if (!target) return; // outside herdr: no-op, no handlers

	const labeled = new Set<string>();
	let lastLabel: string | undefined;

	async function renameTab(label: string): Promise<boolean> {
		try {
			await execFileAsync(target!.bin, ["tab", "rename", target!.tabId, label], {
				timeout: 5000,
			});
			return true;
		} catch (error) {
			pi.logger.warn("omp-herdr-tab-title: rename failed", { error });
			return false;
		}
	}

	async function apply(ctx: ExtensionContext): Promise<void> {
		const sid = ctx.sessionManager.getSessionId();
		if (labeled.has(sid)) return;
		const name = ctx.sessionManager.getSessionName();
		if (!name) return;
		const label = abbreviateSessionName(name);
		// First name per session wins; empty label marks the sid done too.
		if (label === "" || label === lastLabel) {
			labeled.add(sid);
			return;
		}
		if (await renameTab(label)) {
			labeled.add(sid);
			lastLabel = label;
		}
	}

	function applyWithRetries(ctx: ExtensionContext): void {
		void apply(ctx).then(() => {
			const sid = ctx.sessionManager.getSessionId();
			if (labeled.has(sid) || ctx.sessionManager.getSessionName()) return;
			// Auto title is generated async after the turn; poll a few times.
			for (const delay of RETRY_DELAYS_MS) {
				ctx.setTimeout(() => {
					if (ctx.sessionManager.getSessionId() !== sid) return;
					void apply(ctx);
				}, delay);
			}
		});
	}

	pi.on("session_start", (_event, ctx) => applyWithRetries(ctx));
	pi.on("session_switch", (_event, ctx) => applyWithRetries(ctx));
	pi.on("session_branch", (_event, ctx) => applyWithRetries(ctx));
	pi.on("session_tree", (_event, ctx) => applyWithRetries(ctx));
	pi.on("turn_end", (_event, ctx) => applyWithRetries(ctx));
}
