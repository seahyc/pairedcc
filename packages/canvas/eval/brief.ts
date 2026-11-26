// Compact tool listing for `mcp-call.ts list --brief`. Pure, so it can be tested.
/** One line per tool, "name(param, optional?)", for a quick look before reading the full schemas. */
export function briefListing(tools: { name: string; inputSchema: unknown }[]) {
  return tools
    .map(({ name, inputSchema }) => {
      const schema = (inputSchema ?? {}) as { properties?: Record<string, unknown>; required?: string[] };
      const required = new Set(schema.required ?? []);
      const params = Object.keys(schema.properties ?? {}).map((p) => (required.has(p) ? p : `${p}?`));
      return `${name}(${params.join(", ")})`;
    })
    .join("\n");
}
