/**
 * Pelcro Sentry Middleware - 2025 Edition
 * 
 * USAGE: import { sentryMiddleware } from '@pelcro-inc/sentry-middleware';
 * 
 * ✅ Auto-captures errors from try-catch blocks
 * ✅ Smart filtering - only actionable technical errors  
 * ✅ Automatic Lambda context and integration tagging
 * ✅ Captures 4xx client errors as errors (previously silently dropped)
 */

import * as Sentry from '@sentry/aws-serverless';
import { type NodeOptions } from '@sentry/node';

// Performance optimizations
let _initialized = false;
let _serviceName: string | null = null;
let _errorCache = new Map<string, number>();
let _cacheCleanupInterval: NodeJS.Timeout | null = null;

/**
 * Get environment efficiently
 */
const getEnvironment = (): string => {
  // Check lambda function name for environment detection
  const lambdaFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME || '';
  
  // Check if lambda function name indicates environment
  if (lambdaFunctionName.startsWith('stg')) {
    return 'staging';
  }
  if (lambdaFunctionName.startsWith('prod')) {
    return 'production';
  }
  
  // Fallback to environment variables
  return (process.env.PELCRO_ENV || 
          process.env.NODE_ENV || 
          process.env.Environment || 
          "production").toLowerCase();
};

/**
 * Extract integration name with caching
 */
const getIntegrationName = (): string => {
  if (_serviceName) return _serviceName;
  
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME || '';
  
  // Handle environment-prefixed function names like "stg-pelcro-edweek-iterable"
  // or "prod-pelcro-edweek-iterable" or "integration-pelcro-edweek-iterable"
  let match = functionName.match(/^(stg|prod|integration)-(.+)/);
  
  if (match) {
    // Extract the integration name after the environment prefix
    _serviceName = match[2];
  } else {
    // Fallback: try to extract after "integration-" for backward compatibility
    match = functionName.match(/integration-(.+)/);
    _serviceName = match ? match[1] : 'unknown-integration';
  }
  
  return _serviceName;
};

/**
 * Smart error filter - returns severity level or false to skip.
 * 4xx / 5xx / 401 / infra → 'error'
 * generic/unrecognised → false (suppressed)
 */
const shouldAutoCapture = (error: any): 'warning' | 'error' | false => {
  if (!error || typeof error !== 'object') return false;

  const message = error.message || '';
  const status = error.status || error.statusCode || error.response?.status;

  // Skip if message is too generic/short (low signal)
  if (message.length < 10 ||
      /^Error$|^undefined$|^null$|^400$|^404$/.test(message)) return false;

  // Server errors and auth issues → error
  if (status >= 500 || status === 401) return 'error';

  // All other 4xx client errors → error (previously silently dropped)
  if (status >= 400 && status < 500) return 'error';

  // Technical/infrastructure errors → error
  const technicalErrors = [
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EHOSTUNREACH/i,
    /timeout|connection.*failed|network.*error|socket.*hang.*up/i,
    /database.*error|connection.*lost|query.*failed/i,
    /TypeError|ReferenceError|SyntaxError|RangeError/i,
    /JSON\.parse|cannot.*read.*property|is.*not.*a.*function/i,
    /getaddrinfo.*ENOTFOUND/i
  ];

  return technicalErrors.some(pattern =>
    pattern.test(message) || pattern.test(error.name || '')) ? 'error' : false;
};

/**
 * Efficient error deduplication to prevent spam
 */
const isDuplicateError = (error: Error): boolean => {
  const key = `${error.name}:${error.message}:${error.stack?.split('\n')[1] || ''}`;
  const now = Date.now();
  const lastSeen = _errorCache.get(key);
  
  // Only report same error once per 5 minutes
  if (lastSeen && (now - lastSeen) < 300000) return true;
  
  _errorCache.set(key, now);
  return false;
};

/**
 * Initialize Sentry with optimal configuration
 */
const initSentry = (sentryOptions: NodeOptions) => {
  if (_initialized) return;
  
  const environment = getEnvironment();
  const integrationName = getIntegrationName();
  
  // Only initialize in production/staging
  if (!['production', 'staging'].includes(environment)) {
    console.log(`📊 Sentry disabled in ${environment} environment`);
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN || sentryOptions.dsn || "https://01a6699de1f0cda4a59e988eb777309d@o1078112.ingest.us.sentry.io/4510001856905217",
    environment,
    release: integrationName,
    
    // Optimized performance settings
    tracesSampleRate: environment === 'production' ? 0.1 : 0.2,
    maxBreadcrumbs: 30,
    sendDefaultPii: false,
    
    // Override with user options
    ...sentryOptions,
    
    // Global tags for all events
    initialScope: {
      tags: {
        integration: integrationName,
        service: integrationName,
        environment,
        auto_capture: true,
        // Lambda-specific tags
        lambda_function_name: process.env.AWS_LAMBDA_FUNCTION_NAME || integrationName,
        lambda_region: process.env.AWS_REGION || 'unknown',
        lambda_runtime: process.env.AWS_EXECUTION_ENV || 'nodejs',
      },
      ...sentryOptions.initialScope
    },
    
    // Ensure integration name is on EVERY event
    beforeSend: (event, hint) => {
      // Force integration name on all events
      if (!event.tags) event.tags = {};
      event.tags.integration = integrationName;
      event.tags.service = integrationName;
      
      // Add integration name to error title for better visibility
      if (event.exception && event.exception.values && event.exception.values.length > 0) {
        const error = event.exception.values[0];
        if (error.type) {
          // Create clear title with integration name
          const errorMessage = error.value || 'Unknown error';
          event.message = `[${integrationName.toUpperCase()}] ${error.type}: ${errorMessage}`;
        }
      }
      
      // Handle messages/events without exceptions
      if (!event.exception && event.message) {
        event.message = `[${integrationName.toUpperCase()}] ${event.message}`;
      }
      
      console.log(`📤 Sending to Sentry with message: ${event.message}`);
      
      // Call original beforeSend if provided
      if (sentryOptions.beforeSend) {
        return sentryOptions.beforeSend(event, hint);
      }
      
      return event;
    }
  });

  // Setup cache cleanup every 10 minutes to prevent memory leaks
  _cacheCleanupInterval = setInterval(() => {
    const cutoff = Date.now() - 600000; // 10 minutes
    for (const [key, timestamp] of _errorCache.entries()) {
      if (timestamp < cutoff) _errorCache.delete(key);
    }
  }, 600000);

  _initialized = true;
  console.log(`📊 Sentry auto-capture enabled for ${integrationName}`);

  // Setup auto-capture hooks
  setupAutoCapture();
};

/**
 * SAFE AUTOMATIC ERROR CAPTURE SYSTEM
 * 
 * Hooks into console.error and console.log which are commonly used
 * in try-catch blocks to automatically capture relevant errors
 */
const setupAutoCapture = () => {
  if (!_initialized) return;

  // Store original console methods
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  
  // Smart console.error hooking
  console.error = function(...args: any[]) {
    // Call original first to maintain normal logging
    originalConsoleError.apply(console, args);
    
    // Look for Error objects in arguments
    args.forEach(arg => {
      const level = arg instanceof Error ? shouldAutoCapture(arg) : false;
      if (level && !isDuplicateError(arg)) {

        // Use setImmediate to avoid blocking the current execution
        setImmediate(() => {
          try {
            Sentry.withScope((scope) => {
              scope.setTag('capture_method', 'auto_console_error');
              scope.setTag('integration', getIntegrationName());
              scope.setTag('service', getIntegrationName());
              scope.setLevel(level);

              Sentry.captureException(arg);
            });
          } catch (e) {
            // Fail silently to avoid recursion
          }
        });
      }
    });
  };

  // Hook into console.log for error patterns
  console.log = function(...args: any[]) {
    originalConsoleLog.apply(console, args);

    // Look for error patterns like "Error:", "Failed:", etc.
    args.forEach(arg => {
      if (typeof arg === 'string' &&
          /error:|failed:|exception:/i.test(arg) &&
          args.length > 1) {

        const errorArg: Error | undefined = args.find(a => a instanceof Error);
        const level = errorArg ? shouldAutoCapture(errorArg) : false;
        if (errorArg && level && !isDuplicateError(errorArg)) {

          setImmediate(() => {
            try {
              Sentry.withScope((scope) => {
                scope.setTag('capture_method', 'auto_log_pattern');
                scope.setTag('integration', getIntegrationName());
                scope.setTag('service', getIntegrationName());
                scope.setLevel(level);

                Sentry.captureException(errorArg);
              });
            } catch (e) {
              // Fail silently
            }
          });
        }
      }
    });
  };

  console.log(`🎯 Auto-capture hooks installed for ${getIntegrationName()}`);
};

/**
 * Modern Sentry middleware for 2025 - Middy compatible
 */
export function sentryMiddleware(sentryOptions: NodeOptions, _optionalScopeCb?: (scope: any) => void) {
  
  function initializeSentry(request: any) {
    // Initialize Sentry
    initSentry(sentryOptions);
    
    if (!_initialized) return;
    
    // Set request-specific context using withScope
    Sentry.withScope((scope: any) => {
      // Legacy webhook data support
      scope.setExtra("data", request?.event?.data);
      scope.setTag("webhook_id", request?.event?.event_id);
      scope.setTag("type", request?.event?.webhook_type);
      scope.setTag(
        `${request?.event?.type?.split(".")[0]}_id`,
        request?.event?.data?.object?.id
      );
      
      // Enhanced context
      scope.setTag('integration', getIntegrationName());
      scope.setTag('service', getIntegrationName());
      
      if (_optionalScopeCb) {
        _optionalScopeCb(scope);
      }
    });
  }

  return {
    before: initializeSentry,
  };
}

/**
 * Optimized Lambda wrapper leveraging Sentry's built-in features
 */
export const wrapSentry = (handler: any) => {
  // Initialize with default options if not already done
  if (!_initialized) {
    initSentry({
      dsn: process.env.SENTRY_DSN || "https://01a6699de1f0cda4a59e988eb777309d@o1078112.ingest.us.sentry.io/4510001856905217"
    });
  }
  
  if (!_initialized) return handler;
  
  // Use Sentry's optimized Lambda wrapper with additional context
  const sentryWrapped = Sentry.wrapHandler(handler);
  
  return async (event: any, context: any, callback?: any) => {
    // Set request-specific tags for this invocation
    Sentry.setTag('request_id', context?.awsRequestId || 'unknown');
    Sentry.setTag('integration', getIntegrationName());
    Sentry.setTag('service', getIntegrationName());
    
    if (context?.invokedFunctionArn) Sentry.setTag('function_arn', context.invokedFunctionArn);
    if (context?.memoryLimitInMB) Sentry.setTag('memory_limit_mb', context.memoryLimitInMB);
    
    // Set Lambda invocation context
    Sentry.setContext('lambda_invocation', {
      request_id: context?.awsRequestId,
      function_arn: context?.invokedFunctionArn,
      memory_limit_mb: context?.memoryLimitInMB,
      remaining_time_ms: context?.getRemainingTimeInMillis?.(),
      log_group_name: context?.logGroupName,
      log_stream_name: context?.logStreamName,
    });
    
    return sentryWrapped(event, context, callback);
  };
};

/**
 * Manual capture function for explicit error reporting
 */
export const captureException = (error: Error, context: any = {}) => {
  const level = shouldAutoCapture(error);
  if (!_initialized || !level) return;

  Sentry.withScope((scope) => {
    if (context.handler) scope.setTag('handler', context.handler);
    if (context.operation) scope.setTag('operation', context.operation);
    if (context.webhookType) scope.setTag('webhook_type', context.webhookType);

    scope.setTag('capture_method', 'manual');
    scope.setTag('integration', getIntegrationName());
    scope.setLevel(level);

    if (context.data) scope.setContext('additional_data', context.data);

    Sentry.captureException(error);
  });
};

/**
 * Capture messages with context
 */
export const captureMessage = (message: string, level: any = 'error', context: any = {}) => {
  if (!_initialized) return;
  
  Sentry.withScope((scope) => {
    if (context.handler) scope.setTag('handler', context.handler);
    if (context.operation) scope.setTag('operation', context.operation);
    
    scope.setTag('capture_method', 'manual_message');
    scope.setTag('integration', getIntegrationName());
    
    Sentry.captureMessage(message, level);
  });
};

/**
 * Add breadcrumb for debugging
 */
export const addBreadcrumb = (message: string, category = 'webhook', data: any = {}) => {
  if (!_initialized) return;
  
  Sentry.addBreadcrumb({
    message,
    category,
    level: 'info',
    data
  });
};

/**
 * Safe flush function
 */
export const flushSentry = (timeout = 5000): Promise<boolean> => {
  if (!_initialized) return Promise.resolve(true);
  
  try {
    return Sentry.flush(timeout);
  } catch (error: any) {
    console.error('Failed to flush Sentry:', error.message);
    return Promise.resolve(true);
  }
};

// Legacy export compatibility
export const wrapper = Sentry.wrapHandler;

// Export Sentry instance for advanced usage
export { Sentry };

// Export utility functions
export { getIntegrationName, shouldAutoCapture };

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  if (_initialized) {
    Sentry.withScope((scope) => {
      scope.setTag('error_type', 'uncaught_exception');
      scope.setTag('integration', getIntegrationName());
      scope.setTag('service', getIntegrationName());
      scope.setLevel('fatal');
      Sentry.captureException(error);
    });
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);  
  if (_initialized && reason instanceof Error) {
    Sentry.withScope((scope) => {
      scope.setTag('error_type', 'unhandled_rejection');
      scope.setTag('integration', getIntegrationName());
      scope.setTag('service', getIntegrationName());
      scope.setLevel('error');
      Sentry.captureException(reason);
    });
  }
});

// Cleanup on process exit
process.on('exit', () => {
  if (_cacheCleanupInterval) clearInterval(_cacheCleanupInterval);
});