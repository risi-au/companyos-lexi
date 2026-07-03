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

export class CapabilityNotFoundError extends KernelError {
  public readonly scopePath: string;
  public readonly capabilityName: string;
  constructor(scopePath: string, name: string) {
    super(`Capability not found: ${name} in scope ${scopePath}`);
    this.name = "CapabilityNotFoundError";
    this.scopePath = scopePath;
    this.capabilityName = name;
  }
}

export class AlertValidationError extends KernelError {
  public readonly field: string;
  constructor(field: string, message: string) {
    super(`Alert validation failed for ${field}: ${message}`);
    this.name = "AlertValidationError";
    this.field = field;
  }
}

export class SkillNotFoundError extends KernelError {
  public readonly skillName: string;
  constructor(name: string) {
    super(`Skill not found: ${name}`);
    this.name = "SkillNotFoundError";
    this.skillName = name;
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

export class DocumentNotFoundError extends KernelError {
  public readonly scopePath: string;
  public readonly slug: string;
  constructor(scopePath: string, slug: string) {
    super(`Document not found: ${slug} in scope ${scopePath}`);
    this.name = "DocumentNotFoundError";
    this.scopePath = scopePath;
    this.slug = slug;
  }
}

export class CanvasNotFoundError extends KernelError {
  public readonly scopePath: string;
  public readonly slug: string;
  constructor(scopePath: string, slug: string) {
    super(`Canvas not found: ${slug} in scope ${scopePath}`);
    this.name = "CanvasNotFoundError";
    this.scopePath = scopePath;
    this.slug = slug;
  }
}

export class CanvasSizeError extends KernelError {
  public readonly size: number;
  public readonly max: number;
  constructor(size: number, max: number) {
    super(`Canvas scene exceeds size limit: ${size} bytes > ${max} bytes`);
    this.name = "CanvasSizeError";
    this.size = size;
    this.max = max;
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
