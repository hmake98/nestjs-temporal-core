// A "bad" edit of greetingWorkflow: it no longer schedules the greet activity, so histories
// recorded by the original code cannot replay against it (non-determinism).
export async function greetingWorkflow(name: string): Promise<string> {
    return `Hello, ${name}!`;
}
