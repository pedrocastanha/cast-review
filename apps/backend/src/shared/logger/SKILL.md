# Logger Module

## Overview
The **Logger Module** provides application-wide structured logging using **Winston** with NestJS-compatible formatting. Features automatic caller context extraction (class + method name from stack traces) and environment-aware formatting.

**Module Path**: `src/shared/logger/`

## Architecture

### Key Files
| File | Role |
|------|------|
| `logger.factory.ts` | Factory creating Winston logger with environment-aware formatting (pretty-print in dev, JSON in prod) |
| `logger.service.ts` | `AppLogger` injectable service with automatic caller context extraction |
| `logger.module.ts` | **Global** module exporting `AppLogger` |

### Configuration
- **Dev mode**: NestJS-like console format with colors and pretty-print
- **Prod/test mode**: JSON format for log aggregation systems
- **Test mode**: Log level set to `silent`
- **Auto-context**: Extracts `originClass` and `originMethod` from call stack or exception stack traces

### Dependencies
- **winston** - Structured logging library
- **nest-winston** - NestJS integration for Winston

### Consumers
- **Every service and controller** in the application injects `AppLogger`
- Used in Bot service, Moodle service, Storage service, Mail service, WebSocket gateway, API key auth, etc.

### External Integrations
None — output is console/stdout, designed to be consumed by log aggregators (e.g., Cloud Logging, ELK).

## Code Patterns

### Service Pattern
```typescript
@Injectable()
export class AppLogger implements LoggerService {
  private readonly logger: Logger

  constructor() {
    this.logger = createLogger()
    // Auto-extracts originClass and originMethod from call stack
  }

  log(message: string, context: ContextType = {}) {
    this.logger.info(message, {
      ...context,
      ...this.getDefaultFields(context.exception)
    })
  }

  error(message: string, context: ContextType = {}) {
    this.logger.error(message, {
      ...context,
      ...this.getDefaultFields(context.exception)
    })
  }

  warn(message: string, context: ContextType = {}) {
    this.logger.warn(message, { ...context })
  }

  debug(message: string, context: ContextType = {}) {
    this.logger.debug(message, { ...context })
  }
}
```

### Usage Pattern (in BaseService)
```typescript
export class BaseService {
  constructor(protected readonly logger: AppLogger) {}

  protected safeExecute<T>(fn: () => Promise<T>): Promise<T> {
    try {
      this.logger.debug('Executing operation')
      return await fn()
    } catch (err) {
      this.logger.error(`Operation failed: ${err.message}`, { exception: err })
      return this.handleError(err)
    }
  }
}
```

### Direct Usage
```typescript
constructor(private readonly logger: AppLogger) {}

this.logger.log('User created successfully', { userId: user.id })
this.logger.error('Failed to send email', { email: user.email, error: err.message })
```

## Gotchas & Pitfalls

### 1. Auto-Context Extraction
**Problem**: Logger extracts caller class/method from stack traces, which has performance overhead.
**Solution**: Acceptable for development. In high-throughput production, consider passing context explicitly.

### 2. Test Mode Silence
**Problem**: Log level is `silent` in test mode.
**Solution**: Tests don't produce log output. If you need to assert log calls, mock `AppLogger` in test modules.

### 3. Global Module
**Problem**: LoggerModule is global, so it's available everywhere.
**Solution**: No need to import LoggerModule in every feature module. Just inject `AppLogger` directly.

### 4. JSON Format in Production
**Problem**: Production logs are JSON-formatted for log aggregation.
**Solution**: Ensure log aggregation system (ELK, Cloud Logging, etc.) is configured to parse JSON log lines.
