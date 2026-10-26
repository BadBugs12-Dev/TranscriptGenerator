import {test} from "node:test";
import assert from "node:assert/strict";
import {belowFreeLimits,isProEntitlement,usageBoundaries} from "../lib/usage-policy";
import {safeNext} from "../lib/auth-redirect";
import {signState,verifyState} from "../lib/signed-state";
test("Free access requires BOTH daily and monthly headroom",()=>{
  assert.equal(belowFreeLimits(2,14),true);
  assert.equal(belowFreeLimits(3,5),false);
  assert.equal(belowFreeLimits(0,15),false);
  assert.equal(belowFreeLimits(3,15),false);
});
test("Pro depends only on future valid expiry",()=>{
  const now=Date.parse("2026-10-26T12:00:00Z");
  assert.equal(isProEntitlement("2026-10-26T12:00:01Z",now),true);
  for(const expiry of [null,undefined,"invalid","2026-10-26T12:00:00Z","2020-01-01"]) assert.equal(isProEntitlement(expiry,now),false);
});
test("UTC day/month boundaries are deterministic across local time zones",()=>{
  assert.deepEqual(usageBoundaries(new Date("2026-10-01T01:00:00+03:00")),{day:"2026-09-30T00:00:00.000Z",month:"2026-09-01T00:00:00.000Z"});
});
test("Auth redirects stay on the website",()=>{
  for(const path of ["https://evil.test","//evil.test","/\\evil.test","/\r\nevil","/\t/evil.test"]) {
    assert.equal(safeNext(path),"/dashboard");
    assert.equal(new URL(safeNext(path),"https://app.test").origin,"https://app.test");
  }
  assert.equal(safeNext("/pricing?plan=pro"),"/pricing?plan=pro");
});
test("Signed trial/receipt rejects tampering, expiry, purpose swapping",()=>{
  process.env.APP_SIGNING_SECRET="test-only-app-secret-at-least-32-characters";
  const state={purpose:"trial" as const,owner:"guest:test",expires:2000};
  const token=signState(state);
  assert.deepEqual(verifyState(token,"trial",1000),state);
  assert.equal(verifyState(token,"trial",2000),null);
  assert.equal(verifyState(token,"transcript",1000),null);
  assert.equal(verifyState(token+"x","trial",1000),null);
  assert.equal(verifyState(token+".extra","trial",1000),null);
});
