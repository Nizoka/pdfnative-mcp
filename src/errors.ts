/**
 * Custom error type for tool-level failures (returned to client as `isError: true`).
 */
export class ToolError extends Error {
    public override readonly name: string = 'ToolError';
    public readonly code: string;

    public constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

/**
 * Custom error for security-related violations (path traversal, sandbox escapes).
 */
export class SecurityError extends ToolError {
    public override readonly name: string = 'SecurityError';

    public constructor(message: string) {
        super('SECURITY_VIOLATION', message);
    }
}
