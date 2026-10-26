import assert from "node:assert/strict";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:3147";
const post = (path,body,cookie,requestOrigin=origin) => fetch(`${origin}${path}`,{method:"POST",headers:{"Content-Type":"application/json",Origin:requestOrigin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
for (const [path,text] of [["/","YouTube transcripts."],["/pricing","$1.99"],["/login","Email address"],["/signup","Create free account"]]) {
  const response=await fetch(`${origin}${path}`);
  assert.equal(response.status,200,path);
  assert.ok((await response.text()).includes(text),`${path} content`);
}
const dashboard=await fetch(`${origin}/dashboard`,{redirect:"manual"});
assert.equal(dashboard.status,307);
assert.ok(dashboard.headers.get("location")?.includes("/login"));
for (const path of ["/auth/callback", "/auth/confirm"]) {
  const response=await fetch(`${origin}${path}`,{redirect:"manual"});
  assert.equal(response.status,307);
  assert.equal(new URL(response.headers.get("location")).origin,origin,"Auth redirects must use public request origin");
}
assert.equal((await post("/api/transcript",{url:"https://example.com/video"})).status,400);
assert.equal((await post("/api/transcript",{url:"https://youtu.be/jNQXAC9IVRw"},null,"https://other.invalid")).status,403);
assert.equal((await post("/api/download",{url:"https://youtu.be/jNQXAC9IVRw"})).status,401);
assert.equal((await post("/api/gumroad/checkout",{tier:"regular",recurrence:"monthly"})).status,401);
const noCaptions=await post("/api/transcript",{url:"https://youtu.be/hY7m5jjJ9mM"});
assert.equal(noCaptions.status,422);
assert.equal((await noCaptions.json()).code,"NO_CAPTIONS");
assert.ok(!noCaptions.headers.getSetCookie().some(v=>v.startsWith("tg_trial=")),"No-caption request must not use trial");
const first=await post("/api/transcript",{url:"https://youtu.be/jNQXAC9IVRw"});
assert.equal(first.status,200);
const data=await first.json();
assert.ok(data.result.segments.length>0);
assert.ok(data.result.languages.some(v=>v.code==="de"));
assert.equal(data.isPro,false);
const trial=first.headers.getSetCookie().find(v=>v.startsWith("tg_trial="));
assert.ok(trial?.includes("HttpOnly"));
const cookie=trial.split(";")[0];
const second=await post("/api/transcript",{url:"https://youtu.be/hY7m5jjJ9mM"},cookie);
assert.equal(second.status,401);
assert.equal((await second.json()).code,"AUTH_REQUIRED");
const language=await post("/api/transcript",{url:"https://www.youtube.com/shorts/jNQXAC9IVRw",language:"de",receipt:data.receipt},cookie);
assert.equal(language.status,200);
assert.ok((await language.json()).result.segments[0].text.includes("Elefanten"));
const wrongVideo=await post("/api/transcript",{url:"https://youtu.be/hY7m5jjJ9mM",receipt:data.receipt},cookie);
assert.equal(wrongVideo.status,401,"Receipt must not authorize another video");
console.log("HTTP smoke passed: pages, dashboard protection, invalid URL, origin rejection, download/checkout auth, no-caption trial preservation, one anonymous trial, language switching, receipt binding.");
