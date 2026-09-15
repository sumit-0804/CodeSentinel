/**
 * @code-sentinel/contracts
 *
 * One zod schema and one inferred type per OpenAPI schema in `docs/design/openapi/`.
 * `FooSchema` validates at runtime; `Foo` is `z.infer<typeof FooSchema>`.
 * Example payloads live under `@code-sentinel/contracts/examples`.
 */

export * from "./common.js";
export * from "./agent.js";
export * from "./orchestrator.js";
export * from "./gateway.js";
