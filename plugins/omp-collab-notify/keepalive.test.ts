import { describe, expect, test } from "bun:test";
import {
	DEFAULT_RELAY,
	IV_BYTES,
	encodeEnvelope,
	guestUrl,
	importRoomKey,
	openFrame,
	parseEnvelope,
	parseLink,
	seal,
	type RoomLink,
} from "./keepalive";

const ROOM_ID = "K33pAl1veR00m";
const KEY32 = "w7Uwpn-SR7Bj5qWUstpISAQqTrv80pwZy16nitGDbvY";
const KEY48 = "gJlzdA1HkE-ICEbYV0pYM__yJ7gUeWIQpyEq5SaQN_KFJnlCn8BXzdnGHJ6-qWl6";
const KEY31 = KEY32.slice(0, 42); // 42 base64url chars decode to 31 bytes

const bytes = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, "base64url"));

function okLink(raw: string): RoomLink {
	const parsed = parseLink(raw);
	if ("error" in parsed) throw new Error(`expected a link, got: ${parsed.error}`);
	return parsed;
}

describe("parseLink", () => {
	test("https web link with hash", () => {
		const link = okLink(`https://my.omp.sh/#${ROOM_ID}.${KEY32}`);
		expect(link.wsUrl).toBe(`${DEFAULT_RELAY}/r/${ROOM_ID}`);
		expect(link.roomId).toBe(ROOM_ID);
		expect(Buffer.from(link.key).equals(bytes(KEY32))).toBe(true);
		expect(link.writeToken).toBeUndefined();
	});

	test("host-only form with hash", () => {
		expect(okLink(`my.omp.sh/#${ROOM_ID}.${KEY32}`).wsUrl).toBe(`${DEFAULT_RELAY}/r/${ROOM_ID}`);
	});

	test("bare <id>.<key>", () => {
		const link = okLink(`${ROOM_ID}.${KEY32}`);
		expect(link.wsUrl).toBe(`${DEFAULT_RELAY}/r/${ROOM_ID}`);
		expect(link.roomId).toBe(ROOM_ID);
	});

	test("<id>#<key>", () => {
		expect(okLink(`${ROOM_ID}#${KEY32}`).wsUrl).toBe(`${DEFAULT_RELAY}/r/${ROOM_ID}`);
	});

	test("%23 decodes to a hash", () => {
		expect(okLink(`https://my.omp.sh/%23${ROOM_ID}.${KEY32}`).roomId).toBe(ROOM_ID);
	});

	test("key carried in the /r/ path", () => {
		const link = okLink(`wss://my.omp.sh/r/${ROOM_ID}.${KEY32}`);
		expect(link.wsUrl).toBe(`${DEFAULT_RELAY}/r/${ROOM_ID}`);
		expect(Buffer.from(link.key).equals(bytes(KEY32))).toBe(true);
	});

	test("48-byte full link splits the writeToken", () => {
		const link = okLink(`${ROOM_ID}.${KEY48}`);
		expect(Buffer.from(link.key).equals(bytes(KEY48).subarray(0, 32))).toBe(true);
		expect(Buffer.from(link.writeToken ?? "").equals(bytes(KEY48).subarray(32))).toBe(true);
	});

	test("localhost plain ws is accepted", () => {
		expect(okLink(`ws://127.0.0.1:9199/r/${ROOM_ID}.${KEY32}`).wsUrl).toBe(`ws://127.0.0.1:9199/r/${ROOM_ID}`);
	});

	test("non-localhost plain ws is rejected", () => {
		const parsed = parseLink(`ws://example.com/r/${ROOM_ID}.${KEY32}`);
		expect("error" in parsed && parsed.error).toBe(
			"relay link must be wss:// (plain ws:// is only allowed for localhost)",
		);
	});

	test("wrong key byte length is rejected", () => {
		const parsed = parseLink(`wss://my.omp.sh/r/${ROOM_ID}#${KEY31}`);
		expect("error" in parsed && parsed.error).toBe(
			"Collab link key must be 32 (view) or 48 (full) base64url bytes",
		);
	});

	test("garbage input returns an error object", () => {
		const parsed = parseLink("not a link at all");
		expect("error" in parsed && parsed.error).toMatch(/Invalid collab link/);
	});
});

describe("guestUrl", () => {
	test("appends the guest role", () => {
		expect(guestUrl(`wss://my.omp.sh/r/${ROOM_ID}`)).toBe(`wss://my.omp.sh/r/${ROOM_ID}?role=guest`);
	});
});

describe("envelope", () => {
	test("big-endian peerId header", () => {
		expect(Array.from(encodeEnvelope(1, new Uint8Array([0xab])))).toEqual([0, 0, 0, 1, 0xab]);
	});

	test("roundtrip", () => {
		const frame = parseEnvelope(encodeEnvelope(0xdeadbeef, new Uint8Array([1, 2, 3])));
		expect(frame?.peerId).toBe(0xdeadbeef);
		expect(Array.from(frame?.payload ?? [])).toEqual([1, 2, 3]);
	});

	test("short buffer returns null", () => {
		expect(parseEnvelope(new Uint8Array(3))).toBeNull();
	});

	test("respects the input byte offset", () => {
		const padded = new Uint8Array([9, 9, 0, 0, 0, 2, 0xcd]);
		const frame = parseEnvelope(padded.subarray(2));
		expect(frame?.peerId).toBe(2);
		expect(Array.from(frame?.payload ?? [])).toEqual([0xcd]);
	});
});

describe("crypto", () => {
	test("importRoomKey rejects a wrong-size key", async () => {
		await expect(importRoomKey(bytes(KEY31))).rejects.toThrow("Room key must be 32 bytes");
	});

	test("seal/openFrame roundtrip", async () => {
		const key = await importRoomKey(bytes(KEY32));
		const sealed = await seal(key, { t: "hello", proto: 3 });
		expect(sealed.byteLength).toBeGreaterThan(IV_BYTES + 16);
		await expect(openFrame(key, sealed)).resolves.toEqual({ t: "hello", proto: 3 });
	});

	test("tampered payload fails authentication", async () => {
		const key = await importRoomKey(bytes(KEY32));
		const sealed = await seal(key, { t: "hello", proto: 3 });
		sealed[15] ^= 0xff;
		await expect(openFrame(key, sealed)).rejects.toThrow();
	});
});
