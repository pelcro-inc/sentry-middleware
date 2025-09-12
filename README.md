# @pelcro-inc/sentry-middleware

A modern Sentry middleware for Pelcro integrations with automatic error capture and smart filtering.

## Installation

```bash
npm install @pelcro-inc/sentry-middleware
```

## Quick Start

### With Middy (Recommended)

```typescript
import middy from '@middy/core';
import { sentryMiddleware } from '@pelcro-inc/sentry-middleware';

const handler = middy(async (event, context) => {
  // Your Lambda code here
  return { statusCode: 200, body: 'Success' };
});

handler.use(sentryMiddleware({
  dsn: process.env.SENTRY_DSN
}));

export { handler };
```

### With Wrapper

```typescript
import { wrapSentry } from '@pelcro-inc/sentry-middleware';

const handler = wrapSentry(async (event, context) => {
  // Your Lambda code here
  return { statusCode: 200, body: 'Success' };
});

export { handler };
```

### Auto-Initialize

```typescript
// Just import - auto-configures everything!
import '@pelcro-inc/sentry-middleware';

export const handler = async (event, context) => {
  // Errors are automatically captured
  return { statusCode: 200, body: 'Success' };
};
```

## Features

- ✅ **Auto-captures errors** from try-catch blocks
- ✅ **Smart filtering** - only actionable technical errors
- ✅ **Automatic Lambda context** and integration tagging
- ✅ **Performance optimized** with caching and deduplication
- ✅ **TypeScript support** with full type definitions
- ❌ **Ignores 4xx client errors** and validation errors

## Configuration

Set environment variables:

```bash
SENTRY_DSN=your-sentry-dsn
PELCRO_ENV=production  # or staging
```

## API

- `sentryMiddleware(options, scopeCallback?)` - Middy middleware
- `wrapSentry(handler)` - Wraps Lambda handler
- `captureException(error, context?)` - Manual error capture
- `captureMessage(message, level?, context?)` - Capture messages
- `addBreadcrumb(message, category?, data?)` - Add breadcrumbs

## License

ISC © Pelcro Professional Services