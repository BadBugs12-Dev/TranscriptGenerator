import "server-only";
import { NextResponse } from "next/server";
export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function requestOrigin(request: Request) {
  // Next's Node adapter can use localhost in request.url behind its internal
  // server. The Host authority is the browser's actual request destination.
  const internal = new URL(request.url);
  const authority = request.headers.get("host") ?? internal.host;
  if (/[\\/\s]/.test(authority)) throw new ApiError("FORBIDDEN", "Invalid request origin.", 403);
  return new URL(`${internal.protocol}//${authority}`).origin;
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== requestOrigin(request)) {
    throw new ApiError("FORBIDDEN", "Please make this request from the website.", 403);
  }
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError("INVALID_REQUEST", "Expected a JSON request.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("INVALID_REQUEST", "The request is empty.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) { await reader.cancel(); throw new ApiError("INVALID_REQUEST", "The request is too large.", 413); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ApiError("INVALID_REQUEST", "Please check the request and try again."); }
}
export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({error:error.message, code:error.code}, {status:error.status, headers:{"Cache-Control":"private, no-store"}});
  console.error("Request failed", error);
  return NextResponse.json({error:"Something went wrong. Please try again shortly.",code:"SERVER_ERROR"}, {status:500, headers:{"Cache-Control":"private, no-store"}});
}
