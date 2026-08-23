import { describe, expect, test } from "bun:test";
import { parsePr } from "./pr";

describe("parsePr", () => {
	test("valid payload yields number and url", () => {
		expect(parsePr('{"number":42,"url":"https://github.com/o/r/pull/42"}')).toEqual({
			number: 42,
			url: "https://github.com/o/r/pull/42",
		});
	});
	test("non-integer number, empty url, missing fields, bad JSON all yield null", () => {
		expect(parsePr('{"number":1.5,"url":"https://x"}')).toBeNull();
		expect(parsePr('{"number":42,"url":""}')).toBeNull();
		expect(parsePr('{"url":"https://x"}')).toBeNull();
		expect(parsePr("not json")).toBeNull();
	});
});
