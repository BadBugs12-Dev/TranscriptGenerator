import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameOrigin, readJson, ApiError } from "../lib/http";
test("same-origin check uses real request Host through Next internal origin",()=>{
  assert.doesNotThrow(()=>assertSameOrigin(new Request("https://localhost/api/test",{headers:{host:"app.example",origin:"https://app.example"}})));
  for(const origin of ["https://evil.test","http://app.example","null",""]) {
    assert.throws(()=>assertSameOrigin(new Request("https://localhost/api/test",{headers:{host:"app.example",origin}})),ApiError);
  }
});
test("JSON input rejects malformed values and oversized requests",async()=>{
  const make=(body:string)=>new Request("https://app.example",{method:"POST",headers:{"Content-Type":"application/json"},body});
  assert.deepEqual(await readJson(make('{"url":"test"}')),{url:"test"});
  for(const body of ["null","[]","invalid"]) await assert.rejects(readJson(make(body)),ApiError);
  await assert.rejects(readJson(make(JSON.stringify({url:"x".repeat(9000)}))),{status:413});
});
