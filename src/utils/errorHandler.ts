export enum ErrorType {
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  DATA_ERROR = 'DATA_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface BackupError {
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  originalError: any;
  operation: string;
  timestamp: string;
  retryable: boolean;
  suggestedActions: string[];
}

export class ErrorHandler {
  private static errorLog: BackupError[] = [];

  /**
   * Classify and handle errors from database operations
   */
  public static handleDatabaseError(error: any, operation: string): BackupError {
    const backupError = this.classifyError(error, operation);
    this.logError(backupError);
    
    console.error(`🚨 Database Error [${backupError.severity}]: ${backupError.message}`);
    console.error(`   Operation: ${operation}`);
    console.error(`   Type: ${backupError.type}`);
    console.error(`   Retryable: ${backupError.retryable}`);
    
    if (backupError.suggestedActions.length > 0) {
      console.error(`   Suggested Actions:`);
      backupError.suggestedActions.forEach(action => {
        console.error(`     - ${action}`);
      });
    }

    return backupError;
  }

  /**
   * Classify errors by type and determine severity
   */
  private static classifyError(error: any, operation: string): BackupError {
    const errorMessage = (error as any)?.message || error?.toString() || 'Unknown error';
    const errorCode = (error as any)?.code || '';
    const statusCode = (error as any)?.status || (error as any)?.response?.status || 0;

    let type = ErrorType.UNKNOWN_ERROR;
    let severity = ErrorSeverity.MEDIUM;
    let retryable = false;
    let suggestedActions: string[] = [];

    // Connection-related errors
    if (this.isConnectionError(errorMessage, errorCode)) {
      type = ErrorType.CONNECTION_ERROR;
      severity = ErrorSeverity.HIGH;
      retryable = true;
      suggestedActions = [
        'Check internet connection',
        'Verify Supabase service status',
        'Check database URL configuration',
        'Retry operation after a delay'
      ];
    }
    
    // Authentication errors
    else if (this.isAuthenticationError(errorMessage, errorCode, statusCode)) {
      type = ErrorType.AUTHENTICATION_ERROR;
      severity = ErrorSeverity.CRITICAL;
      retryable = false;
      suggestedActions = [
        'Verify Supabase service role key',
        'Check if API key has expired',
        'Ensure proper authentication configuration',
        'Contact administrator for key rotation'
      ];
    }
    
    // Permission errors
    else if (this.isPermissionError(errorMessage, errorCode, statusCode)) {
      type = ErrorType.PERMISSION_ERROR;
      severity = ErrorSeverity.HIGH;
      retryable = false;
      suggestedActions = [
        'Check database permissions for service account',
        'Verify RLS policies allow service role access',
        'Ensure table exists and is accessible',
        'Contact database administrator'
      ];
    }
    
    // Timeout errors
    else if (this.isTimeoutError(errorMessage, errorCode)) {
      type = ErrorType.TIMEOUT_ERROR;
      severity = ErrorSeverity.MEDIUM;
      retryable = true;
      suggestedActions = [
        'Increase timeout duration',
        'Check network stability',
        'Consider breaking operation into smaller chunks',
        'Retry during off-peak hours'
      ];
    }
    
    // Rate limiting errors
    else if (this.isRateLimitError(errorMessage, errorCode, statusCode)) {
      type = ErrorType.RATE_LIMIT_ERROR;
      severity = ErrorSeverity.MEDIUM;
      retryable = true;
      suggestedActions = [
        'Wait before retrying',
        'Implement exponential backoff',
        'Reduce request frequency',
        'Consider upgrading service plan'
      ];
    }
    
    // Data validation errors
    else if (this.isDataError(errorMessage, errorCode)) {
      type = ErrorType.DATA_ERROR;
      severity = ErrorSeverity.LOW;
      retryable = false;
      suggestedActions = [
        'Check data integrity',
        'Validate table schema',
        'Review data types and constraints',
        'Skip corrupted records and continue'
      ];
    }

    return {
      type,
      severity,
      message: errorMessage,
      originalError: error,
      operation,
      timestamp: new Date().toISOString(),
      retryable,
      suggestedActions
    };
  }

  /**
   * Check if error is connection-related
   */
  private static isConnectionError(message: string, code: string): boolean {
    const connectionKeywords = [
      'connection', 'connect', 'network', 'dns', 'host', 'unreachable',
      'refused', 'reset', 'closed', 'disconnected', 'offline'
    ];
    
    const connectionCodes = ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ENETUNREACH'];
    
    const lowerMessage = message.toLowerCase();
    return connectionKeywords.some(keyword => lowerMessage.includes(keyword)) ||
           connectionCodes.includes(code);
  }

  /**
   * Check if error is authentication-related
   */
  private static isAuthenticationError(message: string, code: string, status: number): boolean {
    const authKeywords = [
      'authentication', 'unauthorized', 'invalid credentials', 'api key',
      'token', 'expired', 'invalid jwt', 'authentication failed'
    ];
    
    const authCodes = [401, 403];
    
    const lowerMessage = message.toLowerCase();
    return authKeywords.some(keyword => lowerMessage.includes(keyword)) ||
           authCodes.includes(status);
  }

  /**
   * Check if error is permission-related
   */
  private static isPermissionError(message: string, code: string, status: number): boolean {
    const permissionKeywords = [
      'permission denied', 'forbidden', 'access denied', 'insufficient privileges',
      'not authorized', 'rls', 'row level security', 'policy'
    ];
    
    const lowerMessage = message.toLowerCase();
    return permissionKeywords.some(keyword => lowerMessage.includes(keyword)) ||
           status === 403;
  }

  /**
   * Check if error is timeout-related
   */
  private static isTimeoutError(message: string, code: string): boolean {
    const timeoutKeywords = ['timeout', 'timed out', 'time limit', 'deadline'];
    const timeoutCodes = ['ETIMEDOUT'];
    
    const lowerMessage = message.toLowerCase();
    return timeoutKeywords.some(keyword => lowerMessage.includes(keyword)) ||
           timeoutCodes.includes(code);
  }

  /**
   * Check if error is rate limiting related
   */
  private static isRateLimitError(message: string, code: string, status: number): boolean {
    const rateLimitKeywords = [
      'rate limit', 'too many requests', 'quota exceeded', 'limit exceeded'
    ];
    
    const lowerMessage = message.toLowerCase();
    return rateLimitKeywords.some(keyword => lowerMessage.includes(keyword)) ||
           status === 429;
  }

  /**
   * Check if error is data-related
   */
  private static isDataError(message: string, code: string): boolean {
    const dataKeywords = [
      'invalid data', 'constraint', 'foreign key', 'unique', 'null value',
      'data type', 'invalid input', 'syntax error', 'relation does not exist'
    ];
    
    const lowerMessage = message.toLowerCase();
    return dataKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  /**
   * Log error to internal array
   */
  private static logError(error: BackupError): void {
    this.errorLog.push(error);
    
    // Keep only last 100 errors to prevent memory issues
    if (this.errorLog.length > 100) {
      this.errorLog = this.errorLog.slice(-100);
    }
  }

  /**
   * Get error summary for reporting
   */
  public static getErrorSummary(): {
    totalErrors: number;
    errorsByType: Record<ErrorType, number>;
    errorsBySeverity: Record<ErrorSeverity, number>;
    criticalErrors: BackupError[];
    recentErrors: BackupError[];
  } {
    const errorsByType = {} as Record<ErrorType, number>;
    const errorsBySeverity = {} as Record<ErrorSeverity, number>;
    
    // Initialize counters
    Object.values(ErrorType).forEach(type => errorsByType[type] = 0);
    Object.values(ErrorSeverity).forEach(severity => errorsBySeverity[severity] = 0);
    
    // Count errors
    this.errorLog.forEach(error => {
      errorsByType[error.type]++;
      errorsBySeverity[error.severity]++;
    });
    
    const criticalErrors = this.errorLog.filter(error => 
      error.severity === ErrorSeverity.CRITICAL
    );
    
    const recentErrors = this.errorLog.slice(-10); // Last 10 errors
    
    return {
      totalErrors: this.errorLog.length,
      errorsByType,
      errorsBySeverity,
      criticalErrors,
      recentErrors
    };
  }

  /**
   * Clear error log
   */
  public static clearErrorLog(): void {
    this.errorLog = [];
  }

  /**
   * Check if operation should continue based on error severity
   */
  public static shouldContinueOperation(error: BackupError): boolean {
    // Don't continue for critical errors
    if (error.severity === ErrorSeverity.CRITICAL) {
      return false;
    }
    
    // Don't continue for authentication or permission errors
    if (error.type === ErrorType.AUTHENTICATION_ERROR || 
        error.type === ErrorType.PERMISSION_ERROR) {
      return false;
    }
    
    // Continue for other errors (but log them)
    return true;
  }

  /**
   * Generate error report for notifications
   */
  public static generateErrorReport(): string {
    const summary = this.getErrorSummary();
    
    if (summary.totalErrors === 0) {
      return '✅ No errors encountered during backup operation.';
    }
    
    let report = `🚨 Backup Error Report\n\n`;
    report += `Total Errors: ${summary.totalErrors}\n\n`;
    
    // Errors by severity
    report += `Errors by Severity:\n`;
    Object.entries(summary.errorsBySeverity).forEach(([severity, count]) => {
      if (count > 0) {
        const emoji = severity === 'CRITICAL' ? '🔴' : 
                     severity === 'HIGH' ? '🟠' : 
                     severity === 'MEDIUM' ? '🟡' : '🟢';
        report += `  ${emoji} ${severity}: ${count}\n`;
      }
    });
    
    // Critical errors
    if (summary.criticalErrors.length > 0) {
      report += `\n🔴 Critical Errors:\n`;
      summary.criticalErrors.forEach(error => {
        report += `  - ${error.operation}: ${error.message}\n`;
      });
    }
    
    // Recent errors
    if (summary.recentErrors.length > 0) {
      report += `\nRecent Errors:\n`;
      summary.recentErrors.slice(-5).forEach(error => {
        const emoji = error.severity === 'CRITICAL' ? '🔴' : 
                     error.severity === 'HIGH' ? '🟠' : 
                     error.severity === 'MEDIUM' ? '🟡' : '🟢';
        report += `  ${emoji} ${error.operation}: ${error.message.substring(0, 100)}...\n`;
      });
    }
    
    return report;
  }
}

// Export convenience functions
export const handleDatabaseError = ErrorHandler.handleDatabaseError.bind(ErrorHandler);
export const getErrorSummary = ErrorHandler.getErrorSummary.bind(ErrorHandler);
export const generateErrorReport = ErrorHandler.generateErrorReport.bind(ErrorHandler);
export const shouldContinueOperation = ErrorHandler.shouldContinueOperation.bind(ErrorHandler);