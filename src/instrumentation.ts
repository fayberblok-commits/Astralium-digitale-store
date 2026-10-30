/**
 * Next.js startup hook (stable in Next 15): validate environment formats
 * once when the Node.js server boots and log a feature summary. Never throws.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logEnvSummary } = await import("./lib/env");
    logEnvSummary();
  }
}
