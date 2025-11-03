# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

See **AGENTS.md** for concise command reference, code style guidelines, and architecture overview optimized for agentic coding tools.

## Project Overview

This is a Shopify app built with Remix that provides AI-powered model swapping functionality for product images. The app integrates with fal.ai to perform image editing operations where users can apply prompts to transform product images.

## Subagents, PRP, and AI workflows

- Always use subagents in a PROACTIVE WAY
- When creating a PRD, store the markdown in /prd folder
- Do not start with the implementation until the PRD is validated by the user.

## Core Development Philosophy

### KISS (Keep It Simple, Stupid)

Simplicity should be a key goal in design. Choose straightforward solutions over complex ones whenever possible. Simple solutions are easier to understand, maintain, and debug.

### YAGNI (You Aren't Gonna Need It)

Avoid building functionality on speculation. Implement features only when they are needed, not when you anticipate they might be useful in the future.

### Design Principles

- **Dependency Inversion**: High-level modules should not depend on low-level modules. Both should depend on abstractions.
- **Open/Closed Principle**: Software entities should be open for extension but closed for modification.
- **Single Responsibility**: Each function, class, and module should have one clear purpose.
- **Fail Fast**: Check for potential errors early and raise exceptions immediately when issues occur.

## 🧱 Code Structure & Modularity

### File and Function Limits

- **Never create a file longer than 500 lines of code**. If approaching this limit, refactor by splitting into modules.
- **Functions should be under 50 lines** with a single, clear responsibility.
- **Classes should be under 100 lines** and represent a single concept or entity.
- **Organize code into clearly separated modules**, grouped by feature or responsibility.
- **Line lenght should be max 100 characters** ruff rule in pyproject.toml
- **Use venv_linux** (the virtual environment) whenever executing Python commands, including for unit tests.

## Core Architecture

Follow strict vertical slice architecture with tests living next to the code they test:

### Framework Stack

- **Frontend**: Remix (React-based full-stack framework)
- **Backend**: Remix server functions with Prisma ORM
- **Database**: SQLite (default), configurable for production databases
- **Styling**: Shopify Polaris design system
- **AI Integration**: fal.ai client for image generation/editing
- **TypeScript**: Full type safety across the application

## 🧪 Testing Strategy

### Test-Driven Development (TDD)

1. **Write the test first** - Define expected behavior before implementation
2. **Watch it fail** - Ensure the test actually tests something
3. **Write minimal code** - Just enough to make the test pass
4. **Refactor** - Improve code while keeping tests green
5. **Repeat** - One test at a time

## 🔄 Git Workflow

### Branch Strategy

- `main` - Production-ready code
- `develop` - Integration branch for features
- `feature/*` - New features
- `fix/*` - Bug fixes
- `docs/*` - Documentation updates
- `refactor/*` - Code refactoring
- `test/*` - Test additions or fixes

### Commit Message Format

Never include claude code, or written by claude code in commit messages

```
<type>(<scope>): <subject>

<body>

<footer>
``
Types: feat, fix, docs, style, refactor, test, chore

Example:
```

feat(auth): add two-factor authentication

- Implement TOTP generation and validation
- Add QR code generation for authenticator apps
- Update user model with 2FA fields

Closes #123

``

## 📝 Documentation Standards

### Code Documentation

- Every module should have a docstring explaining its purpose
- Public functions must have complete docstrings
- Complex logic should have inline comments with `# Reason:` prefix
- Keep README.md updated with setup instructions and examples
- Maintain CHANGELOG.md for version history

### Key Directories

- `app/` - Main application code (Remix convention)
    - `features/ai-studio/` - AI image generation feature with components and types
    - `routes/` - Remix routes (file-based routing)
    - `services/` - Business logic services (AI providers, storage)
- `prisma/` - Database schema and migrations
- `extensions/` - Shopify app extensions

### Service Architecture

- **AI Providers** (`app/services/ai-providers.ts`): Abstracted AI service layer with provider pattern
    - `AIProvider` interface for swappable AI services
    - `FalAIProvider` implementation for fal.ai integration
    - `AIProviderFactory` for provider management
- **Storage Service** (`app/services/storage.server.ts`): Handles file storage operations
- **Database** (`app/db.server.ts`): Prisma client configuration

## Essential Commands

### Development

```bash
# Start development server (includes Shopify CLI tunnel)
bun run dev

# Build the application
bun run build

# Run linting
bun run lint
```

### Database Operations

```bash
# Setup database (generate Prisma client + run migrations)
bun run setup

# Access Prisma CLI directly
bun run prisma
```

### Shopify Operations

```bash
# Deploy app to Shopify
bun run deploy

# Link app configuration
bun run config:link

# Generate app extensions
bun run generate
```

### Docker

```bash
# Start in Docker container
bun run docker-start
```

## Code Style & Conventions

### TypeScript Best Practices

- **Always use strict TypeScript** - no `any` types unless absolutely necessary
- **Prefer interfaces over types** for object definitions
- **Use type assertions sparingly** - prefer type guards and validation
- **Export types alongside implementations** for better IDE support

### React/Remix Patterns

- **Use Remix conventions** - loaders for data fetching, actions for mutations
- **Prefer server-side data fetching** over client-side when possible
- **Use Shopify Polaris components** consistently
- **Follow React hooks best practices** - dependencies in useEffect, proper cleanup

### Component Organization

```typescript
// ✅ Good component structure
interface ComponentProps {
  title: string;
  onAction?: () => void;
  children?: React.ReactNode;
}

export function Component({ title, onAction, children }: ComponentProps) {
  // Hook calls at top
  const [state, setState] = useState<string>('');

  // Event handlers
  const handleAction = useCallback(() => {
    onAction?.();
  }, [onAction]);

  // Early returns for loading/error states
  if (!title) return null;

  // Main render
  return (
    <Card>
      <Text variant="headingMd">{title}</Text>
      {children}
    </Card>
  );
}
```

### File Naming Conventions

- **Components**: `PascalCase.tsx` (e.g., `ImageSelector.tsx`)
- **Routes**: Remix convention (`app._index.tsx`, `app.ai-studio.tsx`)
- **Services**: `kebab-case.ts` (e.g., `ai-providers.ts`)
- **Types**: `types.ts` within feature folders
- **Tests**: `component.test.tsx` or `service.test.ts`

## Key Integration Points

### Shopify Integration

- App uses Shopify App Bridge for embedded admin experience
- Authentication handled via `app/shopify.server.ts` with Prisma session storage
- GraphQL Admin API integration for product/image operations
- Webhooks configured for app lifecycle events

### AI Integration

- fal.ai integration through `@fal-ai/client` package
- Uses "fal-ai/gemini-25-flash-image/edit" model for image transformations
- Provider pattern allows for easy swapping of AI services
- Image operations: generate, swap, and optimize (all currently use same model)

### Environment Variables

- `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` - Shopify app credentials
- `FAL_KEY` - fal.ai API key
- `SHOPIFY_APP_URL` - App URL for Shopify configuration
- `SCOPES` - Comma-separated Shopify API scopes

## Development Patterns

### Route Structure

- `app/_index.tsx` - Landing page
- `app/routes/app.*` - Protected admin routes requiring Shopify authentication
- `app/routes/auth.*` - Authentication flow routes
- `app/routes/webhooks.*` - Webhook handlers

### Data Loading Pattern

```typescript
// ✅ Proper Remix loader pattern
export async function loader({ request }: LoaderFunctionArgs) {
	const { admin } = await authenticate.admin(request);

	const response = await admin.graphql(`
    query {
      products(first: 10) {
        nodes {
          id
          title
          images(first: 1) {
            nodes {
              url
            }
          }
        }
      }
    }
  `);

	const data = await response.json();
	return json({ products: data.data.products.nodes });
}
```

### Type Definitions

```typescript
// ✅ Proper type definitions
export interface GeneratedImage {
	id: string;
	imageUrl: string;
	confidence: number;
	metadata?: Record<string, any>;
}

export type DraftItem = { imageUrl: string; sourceUrl?: string | null } | string;

export interface AIImageRequest {
	sourceImageUrl: string;
	prompt: string;
	productId: string;
	modelType?: 'swap' | 'generate' | 'optimize';
}
```

### Component Organization

- AI Studio components in `app/features/ai-studio/components/`
- Follows Shopify Polaris design patterns
- TypeScript types defined in feature-specific `types.ts` files

### Database Schema

- `Session` model for Shopify session management
- `MetricEvent` model for tracking usage analytics (GENERATED, DRAFT_SAVED, etc.)
- Uses SQLite for development, easily configurable for production databases

## Testing Strategy

### Test-Driven Development (TDD)

```bash
# Run tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run tests with coverage
bun run test:coverage
```

1. **Write the test first** - Define expected behavior before implementation
2. **Watch it fail** - Ensure the test actually tests something
3. **Write minimal code** - Just enough to make the test pass
4. **Refactor** - Improve code while keeping tests green
5. **Repeat** - One test at a time

### Component Testing Pattern

```typescript
// ✅ Component test example
import { render, screen } from '@testing-library/react';
import { ImageSelector } from './ImageSelector';

describe('ImageSelector', () => {
  it('renders with provided images', () => {
    const images = [{ id: '1', url: 'test.jpg' }];
    render(<ImageSelector images={images} onSelect={jest.fn()} />);

    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('calls onSelect when image is clicked', async () => {
    const onSelect = jest.fn();
    const images = [{ id: '1', url: 'test.jpg' }];

    render(<ImageSelector images={images} onSelect={onSelect} />);

    await user.click(screen.getByRole('img'));
    expect(onSelect).toHaveBeenCalledWith(images[0]);
  });
});
```

### Test Organization

- Unit tests: Test individual functions/methods in isolation
- Integration tests: Test component interactions
- End-to-end tests: Test complete user workflows
- Keep test files next to the code they test
- Use `conftest.py` for shared fixtures
- Aim for 80%+ code coverage, but focus on critical paths

## Error Handling

### Client-Side Error Boundaries

```typescript
// ✅ Error boundary pattern
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Banner status="critical">
          <Text>Something went wrong. Please refresh the page.</Text>
        </Banner>
      );
    }

    return this.props.children;
  }
}
```

### Server-Side Error Handling

```typescript
// ✅ Remix action error handling
export async function action({ request }: ActionFunctionArgs) {
	try {
		const { admin } = await authenticate.admin(request);
		const formData = await request.formData();

		// Process the action
		const result = await processImage(formData);

		return json({ success: true, result });
	} catch (error) {
		console.error('Action failed:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			},
			{ status: 400 },
		);
	}
}
```

## Performance Considerations

### Optimization Guidelines

- Use React.memo for expensive components
- Implement proper useCallback/useMemo for expensive computations
- Lazy load routes and components when possible
- Optimize images (WebP, proper sizing)
- Use Remix's built-in caching strategies

### Example Optimizations

```typescript
// ✅ Memoized component
const ExpensiveComponent = React.memo(({ data }: { data: ComplexData }) => {
  const processedData = useMemo(() => {
    return expensiveProcessing(data);
  }, [data]);

  return <div>{processedData}</div>;
});

// ✅ Optimized event handler
const handleImageSelect = useCallback((image: GeneratedImage) => {
  onImageSelect?.(image);
}, [onImageSelect]);
```

## Security Best Practices

- Never expose API keys in client-side code
- Validate all user inputs on both client and server
- Use Shopify's authentication patterns consistently
- Sanitize user-generated content before displaying
- Keep dependencies updated regularly

## Important Notes

- App is configured for embedded experience within Shopify Admin
- Uses billing system with $29.99/month subscription and 7-day trial
- Built for App Store distribution
- Supports extensions through `/extensions` directory structure
- Always use Remix patterns for data fetching and mutations
- Follow Shopify Polaris design system for consistency

## 🚀 GitHub Flow Workflow Summary

main (protected) ←── PR ←── feature/your-feature
↓ ↑
deploy development

### Daily Workflow:

1. git checkout main && git pull origin main
2. git checkout -b feature/new-feature
3. Make changes + tests
4. git push origin feature/new-feature
5. Create PR → Review → Merge to main

---
