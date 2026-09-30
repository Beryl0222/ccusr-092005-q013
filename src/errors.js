export class DomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new DomainError(code, message);
}
