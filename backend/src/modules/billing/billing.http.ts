import type { Request, Response } from "express";

// What the security module puts on every authenticated request (see middleware/authenticate.js).
export interface Actor {
  id: string;
  name: string;
  branchId: string;
  roles: string[];
}

interface RequestUser {
  id: number;
  name: string;
  branchId: number;
}

export function actorOf(req: Request): Actor {
  const raw = req as unknown as { user?: RequestUser; roles?: string[] };
  if (!raw.user) {
    throw httpError(401, "UNAUTHENTICATED", "Login required");
  }
  return {
    id: String(raw.user.id),
    name: raw.user.name,
    branchId: String(raw.user.branchId),
    roles: raw.roles ?? [],
  };
}

// Scope granted by the permission (own / branch / all), set by requirePermission().
export function scopeOf(req: Request): string {
  const access = (req as unknown as { access?: { scope?: string } }).access;
  return access?.scope ?? "own";
}

export function bearerOf(req: Request): string {
  const header = req.headers.authorization;
  return typeof header === "string" ? header : "";
}

export interface HttpErrorLike extends Error {
  status: number;
  code: string;
  details?: unknown;
}

export function httpError(status: number, code: string, message: string, details?: unknown): HttpErrorLike {
  const error = new Error(message) as HttpErrorLike;
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

// Billing services throw plain Errors with readable messages. Turn them into the team's error format.
export function toHttpError(error: unknown): HttpErrorLike {
  const e = error as Partial<HttpErrorLike> | undefined;
  if (e && typeof e.status === "number" && typeof e.code === "string") {
    return e as HttpErrorLike;
  }
  const message = error instanceof Error ? error.message : "Request failed";
  if (message.startsWith("No open shift")) return httpError(409, "NO_OPEN_SHIFT", message);
  if (message.includes("not found")) return httpError(404, "NOT_FOUND", message);
  if (
    message.includes("already") ||
    message.includes("exceeds") ||
    message.includes("void bill") ||
    message.includes("is split") ||
    message.includes("does not need")
  ) {
    return httpError(409, "CONFLICT", message);
  }
  return httpError(400, "VALIDATION_ERROR", message);
}

export function sendError(res: Response, error: unknown): void {
  const e = toHttpError(error);
  if (e.status >= 500) console.error(error);
  res.status(e.status).json({
    error: { code: e.code, message: e.message, ...(e.details === undefined ? {} : { details: e.details }) },
  });
}
