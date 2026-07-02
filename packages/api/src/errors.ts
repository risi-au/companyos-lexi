export class KernelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KernelError";
  }
}

export class ScopeNotFoundError extends KernelError {
  public readonly path: string;
  constructor(path: string) {
    super(`Scope not found: ${path}`);
    this.name = "ScopeNotFoundError";
    this.path = path;
  }
}

export class ParentNotFoundError extends KernelError {
  public readonly parentPath: string;
  constructor(parentPath: string) {
    super(`Parent scope not found: ${parentPath}`);
    this.name = "ParentNotFoundError";
    this.parentPath = parentPath;
  }
}

export class DuplicatePathError extends KernelError {
  public readonly path: string;
  constructor(path: string) {
    super(`Duplicate scope path: ${path}`);
    this.name = "DuplicatePathError";
    this.path = path;
  }
}

export class InvalidSlugError extends KernelError {
  public readonly slug: string;
  constructor(slug: string) {
    super(`Invalid slug "${slug}". Slugs must match [a-z0-9-]+`);
    this.name = "InvalidSlugError";
    this.slug = slug;
  }
}

export class AccessDeniedError extends KernelError {
  public readonly principalId: string;
  public readonly scopePath: string;
  public readonly requiredRole: string;
  constructor(principalId: string, scopePath: string, requiredRole: string, message?: string) {
    super(message ?? `Access denied for principal ${principalId} on ${scopePath} (need ${requiredRole})`);
    this.name = "AccessDeniedError";
    this.principalId = principalId;
    this.scopePath = scopePath;
    this.requiredRole = requiredRole;
  }
}

export class TokenNotFoundError extends KernelError {
  constructor(tokenId: string) {
    super(`Token not found: ${tokenId}`);
    this.name = "TokenNotFoundError";
  }
}

export class RecordNotFoundError extends KernelError {
  public readonly id: string;
  constructor(id: string) {
    super(`Record not found: ${id}`);
    this.name = "RecordNotFoundError";
    this.id = id;
  }
}

export interface DashboardSpecValidationErrorDetail {
  path: (string | number)[];
  message: string;
}

export class DashboardValidationError extends KernelError {
  public readonly errors: DashboardSpecValidationErrorDetail[];
  constructor(errors: DashboardSpecValidationErrorDetail[]) {
    const msg = errors.map((e) => `${e.path.join(".") || "spec"}: ${e.message}`).join("; ");
    super(`Dashboard spec invalid: ${msg}`);
    this.name = "DashboardValidationError";
    this.errors = errors;
  }
}
