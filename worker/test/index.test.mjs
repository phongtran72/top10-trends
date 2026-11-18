import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIMARY_CRON, hourCovered, onCron } from "../src/index.ts";

// Plain Node tests (npm test in worker/): the Worker is its own package and
// has no Vitest. Synthetic runs only; nothing here touches the network.

const env = { GH_OWNER: "owner", GH_REPO: "repo", GH_DISPATCH_TOKEN: "test-token" };
const CATCH_UP = "17 * * * *";
const at = (time) => Date.parse(`2026-10-07T${time}Z`);
const run = (createdAt, status, conclusion = null) => ({ created_at: `2026-10-07T${createdAt}Z`, status, conclusion });

// A stand-in for fetch: answers the list of runs and records every request.
function github(runs, { listStatus = 200, dispatchStatus = 204 } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers });
    if (init.method === "POST") return new Response(dispatchStatus === 204 ? null : "{\"message\":\"Server Error\"}", { status: dispatchStatus });
    return new Response(JSON.stringify({ workflow_runs: runs }), { status: listStatus });
  };
  return { calls, fetcher, posts: () => calls.filter((call) => call.method === "POST") };
}

test("an hour with a successful run is covered", () => {
  assert.equal(hourCovered([run("15:07:36", "completed", "success")], new Date(at("15:17:00"))), true);
});

test("last hour's run does not cover this hour", () => {
  assert.equal(hourCovered([run("14:07:38", "completed", "success")], new Date(at("15:17:00"))), false);
});

test("a failed run does not cover the hour", () => {
  assert.equal(hourCovered([run("15:07:36", "completed", "failure")], new Date(at("15:27:00"))), false);
});

test("a run that is queued or still going covers the hour, however long it has waited", () => {
  // GitHub's incident of 2026-10-19: the 16:07 run didn't finish until 16:30.
  assert.equal(hourCovered([run("16:07:31", "in_progress")], new Date(at("16:17:00"))), true);
  assert.equal(hourCovered([run("16:07:31", "queued")], new Date(at("16:27:00"))), true);
});

test("a cancelled run does not cover the hour", () => {
  assert.equal(hourCovered([run("16:07:31", "completed", "cancelled")], new Date(at("16:17:00"))), false);
});

test("a catch-up try starts nothing beside a run that is still queued", async () => {
  const gh = github([run("16:07:31", "queued"), run("15:07:36", "completed", "success")]);
  assert.equal(await onCron(CATCH_UP, at("16:17:00"), env, gh.fetcher), "covered");
  assert.equal(gh.posts().length, 0);
});

test("the primary cron starts a run without reading the list", async () => {
  const gh = github([]);
  assert.equal(await onCron(PRIMARY_CRON, at("15:07:00"), env, gh.fetcher), "dispatched");
  assert.deepEqual(gh.calls.map((call) => call.method), ["POST"]);
  assert.equal(gh.calls[0].url, "https://api.github.com/repos/owner/repo/actions/workflows/collect.yml/dispatches");
  // The token goes in a header, never in the URL.
  assert.equal(gh.calls[0].headers.Authorization, "Bearer test-token");
});

test("a catch-up try starts nothing when the hour has a good run", async () => {
  const gh = github([run("15:07:36", "completed", "success"), run("14:07:38", "completed", "success")]);
  assert.equal(await onCron(CATCH_UP, at("15:17:00"), env, gh.fetcher), "covered");
  assert.equal(gh.posts().length, 0);
});

test("a catch-up try starts a run when the hourly start was refused", async () => {
  const gh = github([run("14:07:38", "completed", "success")]);
  assert.equal(await onCron(CATCH_UP, at("15:17:00"), env, gh.fetcher), "dispatched");
  assert.equal(gh.posts().length, 1);
});

test("a catch-up try starts a run when the hour's run failed", async () => {
  const gh = github([run("20:07:36", "completed", "failure"), run("19:07:37", "completed", "success")]);
  assert.equal(await onCron("27 * * * *", at("20:27:00"), env, gh.fetcher), "dispatched");
  assert.equal(gh.posts().length, 1);
});

test("a catch-up try starts nothing when the list can't be read", async () => {
  const down = github([], { listStatus: 503 });
  await assert.rejects(onCron(CATCH_UP, at("15:17:00"), env, down.fetcher), /could not be read: 503/);
  assert.equal(down.posts().length, 0);
  const empty = github([]);
  await assert.rejects(onCron(CATCH_UP, at("15:17:00"), env, empty.fetcher), /empty list/);
  assert.equal(empty.posts().length, 0);
});

test("a refused start is an error", async () => {
  const gh = github([], { dispatchStatus: 500 });
  await assert.rejects(onCron(PRIMARY_CRON, at("15:07:00"), env, gh.fetcher), /dispatch failed: 500/);
});

test("a missing token is an error before any request", async () => {
  const gh = github([]);
  await assert.rejects(onCron(PRIMARY_CRON, at("15:07:00"), { ...env, GH_DISPATCH_TOKEN: "" }, gh.fetcher), /GH_DISPATCH_TOKEN is not set/);
  assert.equal(gh.calls.length, 0);
});
