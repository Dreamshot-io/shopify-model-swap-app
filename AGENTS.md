# AGENTS.md - Quick Reference for Agentic Coding Agents

> For detailed guidance, philosophy, and comprehensive examples, see **CLAUDE.md**

## Commands

- **Dev**: `bun run dev` (includes Shopify CLI tunnel)
- **Build**: `bun run build` (Prisma generate + migrate + Remix build)
- **Lint**: `bun run lint`
- **Test**: Tests use `@jest/globals` - run with `bun test <file>` (no test runner configured in package.json yet)
- **DB**: `bun run setup` (generate + db push), `bun run prisma` (Prisma CLI)

## Code Style

- **TypeScript**: Strict mode enabled, no `any` types, prefer interfaces over types
- **Imports**: Use `import type` for type-only imports, group by external/internal
- **Components**: PascalCase.tsx, routes follow Remix convention (app.\*.tsx)
- **Functions**: <50 lines, single responsibility, early returns for guards
- **Files**: Max 500 lines, split into feature modules if larger
- **Naming**: camelCase vars/funcs, PascalCase components/types, kebab-case service files
- **Error Handling**: Try-catch in actions/loaders, return json with error messages
- **Comments**: NO comments unless essential (per CLAUDE.md)

## Architecture

- **Remix** framework with file-based routing in `app/routes/`
- **Features** in `app/features/<name>/` with components, handlers, types colocated
- **Services** in `app/services/` for business logic (AI providers, storage, etc.)
- **Tests** live next to code they test (`__tests__/` or `.test.ts`)
