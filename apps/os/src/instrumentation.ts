export async function register() {
  // The NEXT_RUNTIME check must be an if-block wrapping the imports: webpack
  // only dead-code-eliminates the inlined constant in this form (an early
  // return does not stop the edge bundle from resolving the imports, and the
  // api package pulls node builtins like crypto that don't exist there).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.DATABASE_URL) return;
    try {
      const [{ createDb }, { ensureSelfDocs }] = await Promise.all([
        import("@companyos/db"),
        import("@companyos/api"),
      ]);
      const db = createDb();
      await ensureSelfDocs(db);
    } catch (error) {
      console.error("[instrumentation] self-doc seeding failed", error);
    }
  }
}
