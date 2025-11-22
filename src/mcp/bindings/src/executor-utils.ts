import { closeAllConnections } from "./client.js";

export interface ExecutionResult {
    result: any;
    logs: string[];
    exitCode: 0 | 1;
    error?: string;
}

export interface LogCapture {
    logs: string[];
    start: () => void;
    stop: () => void;
}

const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
};

export function createLogCapture(): LogCapture {
    const logs: string[] = [];

    const start = () => {
        console.log = (...args: any[]) => {
            logs.push(args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' '));
        };

        console.error = (...args: any[]) => {
            logs.push('[ERROR] ' + args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' '));
        };

        console.warn = (...args: any[]) => {
            logs.push('[WARN] ' + args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' '));
        };
    };

    const stop = () => {
        console.log = originalConsole.log;
        console.error = originalConsole.error;
        console.warn = originalConsole.warn;
    };

    return { logs, start, stop };
}

/**
 * Standardized executor runner.
 * Takes a handler function that executes the code and returns a result.
 * Handles CLI arguments, log capture, error handling, and JSON output.
 */
export async function runExecutor(handler: (code: string) => Promise<any>) {
    const code = process.argv[2];

    if (!code) {
        originalConsole.error("Usage: tsx <executor_script> '<code>'");
        process.exit(1);
    }

    const logCapture = createLogCapture();
    logCapture.start();

    try {
        const result = await handler(code);

        logCapture.stop();

        const output: ExecutionResult = {
            result,
            logs: logCapture.logs,
            exitCode: 0,
        };
        originalConsole.log(JSON.stringify(output));
        process.exit(0);

    } catch (error) {
        logCapture.stop();

        const output: ExecutionResult = {
            result: null,
            logs: logCapture.logs,
            exitCode: 1,
            error: error instanceof Error ? error.message : String(error),
        };
        // We print the error result to stdout so the caller can parse it, 
        // but we might also want to log to stderr if needed. 
        // For this pattern, we stick to printing the JSON result to stdout.
        originalConsole.log(JSON.stringify(output));
        process.exit(1);

    } finally {
        // Ensure we close any open MCP connections
        await closeAllConnections();
    }
}

// Export original console for internal use if needed
export { originalConsole };
