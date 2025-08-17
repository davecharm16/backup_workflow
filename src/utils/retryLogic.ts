export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBase: number;
  retryCondition?: (error: any) => boolean;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: any;
  attempts: number;
  totalTime: number;
}

export class RetryHandler {
  private static defaultOptions: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    exponentialBase: 2,
    retryCondition: (error: any) => {
      // Default: retry on network errors, timeouts, and temporary failures
      const retryableErrors = [
        'ECONNRESET',
        'ENOTFOUND', 
        'ECONNREFUSED',
        'ETIMEDOUT',
        'Network request failed',
        'timeout',
        'Too Many Requests',
        'Service Temporarily Unavailable',
        'Internal Server Error'
      ];
      
      const errorMessage = error?.message || error?.toString() || '';
      const errorCode = error?.code || '';
      
      return retryableErrors.some(retryableError => 
        errorMessage.includes(retryableError) || errorCode.includes(retryableError)
      );
    }
  };

  /**
   * Execute a function with retry logic
   */
  public static async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {},
    operationName: string = 'Operation'
  ): Promise<RetryResult<T>> {
    const config = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    
    let lastError: any;
    let attempt = 0;

    console.log(`🔄 Starting ${operationName} with retry logic (max ${config.maxAttempts} attempts)`);

    while (attempt < config.maxAttempts) {
      attempt++;
      
      try {
        console.log(`  🎯 Attempt ${attempt}/${config.maxAttempts} for ${operationName}`);
        
        const result = await operation();
        const totalTime = Date.now() - startTime;
        
        console.log(`  ✅ ${operationName} succeeded on attempt ${attempt} (${totalTime}ms)`);
        
        return {
          success: true,
          result,
          attempts: attempt,
          totalTime
        };
        
      } catch (error) {
        lastError = error;
        const errorMessage = (error as any)?.message || error?.toString() || 'Unknown error';
        
        console.log(`  ❌ Attempt ${attempt} failed: ${errorMessage}`);
        
        // Check if we should retry this error
        if (!config.retryCondition!(error)) {
          console.log(`  🛑 Error is not retryable, stopping attempts`);
          break;
        }
        
        // If this is the last attempt, don't wait
        if (attempt === config.maxAttempts) {
          console.log(`  🛑 Max attempts reached, giving up`);
          break;
        }
        
        // Calculate delay with exponential backoff
        const delay = Math.min(
          config.baseDelay * Math.pow(config.exponentialBase, attempt - 1),
          config.maxDelay
        );
        
        console.log(`  ⏳ Waiting ${delay}ms before retry...`);
        await this.sleep(delay);
      }
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`  ❌ ${operationName} failed after ${attempt} attempts (${totalTime}ms)`);
    
    return {
      success: false,
      error: lastError,
      attempts: attempt,
      totalTime
    };
  }

  /**
   * Retry database operations specifically
   */
  public static async retryDatabaseOperation<T>(
    operation: () => Promise<T>,
    operationName: string = 'Database Operation'
  ): Promise<T> {
    const result = await this.executeWithRetry(
      operation,
      {
        maxAttempts: 3,
        baseDelay: 2000, // 2 seconds for database operations
        maxDelay: 15000, // 15 seconds max
        retryCondition: (error: any) => {
          const errorMessage = error?.message?.toLowerCase() || '';
          
          // Database-specific retryable errors
          const dbRetryableErrors = [
            'connection',
            'timeout',
            'network',
            'unavailable',
            'too many',
            'rate limit',
            'temporary',
            'socket',
            'reset'
          ];
          
          return dbRetryableErrors.some(retryableError => 
            errorMessage.includes(retryableError)
          );
        }
      },
      operationName
    );

    if (!result.success) {
      throw new Error(`${operationName} failed after ${result.attempts} attempts: ${result.error?.message}`);
    }

    return result.result!;
  }

  /**
   * Retry Google Drive operations specifically
   */
  public static async retryGoogleDriveOperation<T>(
    operation: () => Promise<T>,
    operationName: string = 'Google Drive Operation'
  ): Promise<T> {
    const result = await this.executeWithRetry(
      operation,
      {
        maxAttempts: 4, // Google Drive can be more flaky
        baseDelay: 1000,
        maxDelay: 20000,
        retryCondition: (error: any) => {
          const errorMessage = error?.message?.toLowerCase() || '';
          const statusCode = error?.response?.status || error?.status || 0;
          
          // Google Drive specific retryable errors
          const driveRetryableErrors = [
            'rate limit',
            'quota exceeded',
            'backend error',
            'internal error',
            'unavailable',
            'timeout',
            'network'
          ];
          
          // Retryable HTTP status codes
          const retryableStatusCodes = [429, 500, 502, 503, 504];
          
          return driveRetryableErrors.some(retryableError => 
            errorMessage.includes(retryableError)
          ) || retryableStatusCodes.includes(statusCode);
        }
      },
      operationName
    );

    if (!result.success) {
      throw new Error(`${operationName} failed after ${result.attempts} attempts: ${result.error?.message}`);
    }

    return result.result!;
  }

  /**
   * Retry email operations specifically
   */
  public static async retryEmailOperation<T>(
    operation: () => Promise<T>,
    operationName: string = 'Email Operation'
  ): Promise<T> {
    const result = await this.executeWithRetry(
      operation,
      {
        maxAttempts: 3,
        baseDelay: 3000, // 3 seconds for email operations
        maxDelay: 10000,
        retryCondition: (error: any) => {
          const errorMessage = error?.message?.toLowerCase() || '';
          
          // Email-specific retryable errors
          const emailRetryableErrors = [
            'connection',
            'timeout',
            'network',
            'temporarily',
            'rate limit',
            'server busy',
            'try again'
          ];
          
          // Don't retry authentication errors
          const nonRetryableErrors = [
            'authentication',
            'invalid credentials',
            'unauthorized',
            'forbidden'
          ];
          
          if (nonRetryableErrors.some(nonRetryable => errorMessage.includes(nonRetryable))) {
            return false;
          }
          
          return emailRetryableErrors.some(retryableError => 
            errorMessage.includes(retryableError)
          );
        }
      },
      operationName
    );

    if (!result.success) {
      throw new Error(`${operationName} failed after ${result.attempts} attempts: ${result.error?.message}`);
    }

    return result.result!;
  }

  /**
   * Sleep for specified milliseconds
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a timeout wrapper for operations
   */
  public static withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string = 'Operation'
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  /**
   * Combine retry logic with timeout
   */
  public static async executeWithRetryAndTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    retryOptions: Partial<RetryOptions> = {},
    operationName: string = 'Operation'
  ): Promise<T> {
    const wrappedOperation = () => this.withTimeout(operation, timeoutMs, operationName);
    
    const result = await this.executeWithRetry(wrappedOperation, retryOptions, operationName);
    
    if (!result.success) {
      throw new Error(`${operationName} failed: ${result.error?.message}`);
    }
    
    return result.result!;
  }
}

// Export convenience functions
export const retryDatabaseOperation = RetryHandler.retryDatabaseOperation.bind(RetryHandler);
export const retryGoogleDriveOperation = RetryHandler.retryGoogleDriveOperation.bind(RetryHandler);
export const retryEmailOperation = RetryHandler.retryEmailOperation.bind(RetryHandler);
export const executeWithRetry = RetryHandler.executeWithRetry.bind(RetryHandler);
export const withTimeout = RetryHandler.withTimeout.bind(RetryHandler);