export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const bad = (msg, details) => new HttpError(400, 'VALIDATION_ERROR', msg, details);
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have permission for this action', code = 'FORBIDDEN') =>
  new HttpError(403, code, msg);
