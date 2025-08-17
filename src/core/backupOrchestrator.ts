import { supabaseClient } from '../database/supabaseClient';
import { DatabaseExporter } from '../database/exporter';
import { SqlExporter } from '../formats/sqlExporter';
import { JsonExporter } from '../formats/jsonExporter';
import { ExcelExporter } from '../formats/excelExporter';
import { FileManager, FileMetadata } from '../utils/fileManager';
import { DriveUploaderOAuth, OAuthDriveUploadResult } from '../storage/driveUploaderOAuth';
import { EmailService, BackupSummary, NotificationOptions } from '../notifications/emailService';
import { format as formatDate } from 'date-fns';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface BackupConfig {
  formats: ('sql' | 'json' | 'xlsx')[];
  compression: boolean;
  notifications: NotificationOptions;
  retryAttempts: number;
  outputDirectory: string;
}

export interface BackupResult {
  success: boolean;
  summary: BackupSummary;
  errors: string[];
}

export interface FileExportResult {
  filename: string;
  filePath: string;
  format: 'sql' | 'json' | 'xlsx';
  size: number;
  compressed: boolean;
  compressedSize?: number;
  checksum: string;
}

export class BackupOrchestrator {
  private static defaultConfig: BackupConfig = {
    formats: ['sql', 'json', 'xlsx'],
    compression: true,
    notifications: {
      sendOnSuccess: true,
      sendOnFailure: true,
      sendOnPartial: true,
      recipients: [],
      includeDetails: true,
      includeLogs: false
    },
    retryAttempts: 3,
    outputDirectory: './backup-files'
  };

  /**
   * Execute complete backup workflow
   */
  public static async executeBackup(config: Partial<BackupConfig> = {}): Promise<BackupResult> {
    const finalConfig = { ...this.defaultConfig, ...config };
    const startTime = new Date();
    const errors: string[] = [];
    const fileResults: Array<{
      filename: string;
      format: string;
      size: number;
      compressed: boolean;
      uploadStatus: 'success' | 'failed';
      driveUrl?: string;
      error?: string;
    }> = [];

    console.log('🚀 Starting Gym Database Backup Process');
    console.log(`📅 Started at: ${formatDate(startTime, 'PPP p')}`);
    console.log(`📊 Formats: ${finalConfig.formats.join(', ')}`);
    console.log(`🗜️  Compression: ${finalConfig.compression ? 'Enabled' : 'Disabled'}`);

    try {
      // Initialize services
      await this.initializeServices();

      // Export data in requested formats
      const exportResults = await this.exportData(finalConfig);
      
      // Upload files to Google Drive
      const uploadResults = await this.uploadFiles(exportResults, finalConfig);
      
      // Process results
      for (let i = 0; i < exportResults.length; i++) {
        const exportResult = exportResults[i];
        const uploadResult = uploadResults[i];
        
        if (exportResult && uploadResult) {
          fileResults.push({
            filename: exportResult.filename,
            format: exportResult.format,
            size: exportResult.size,
            compressed: exportResult.compressed,
            uploadStatus: uploadResult.success ? 'success' : 'failed',
            ...(uploadResult.result?.driveUrl && { driveUrl: uploadResult.result.driveUrl }),
            ...(uploadResult.error && { error: uploadResult.error })
          });
          
          if (!uploadResult.success && uploadResult.error) {
            errors.push(`Upload failed for ${exportResult.filename}: ${uploadResult.error}`);
          }
        }
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      
      // Calculate statistics
      const totalSize = exportResults.reduce((sum, result) => sum + result.size, 0);
      const compressedSize = exportResults.reduce((sum, result) => 
        sum + (result.compressedSize || result.size), 0);
      const compressionRatio = totalSize > 0 ? totalSize / compressedSize : 1;
      
      const successfulUploads = fileResults.filter(f => f.uploadStatus === 'success').length;
      const failedUploads = fileResults.filter(f => f.uploadStatus === 'failed').length;
      
      // Determine overall status
      let status: 'success' | 'failure' | 'partial';
      if (failedUploads === 0) {
        status = 'success';
      } else if (successfulUploads === 0) {
        status = 'failure';
      } else {
        status = 'partial';
      }

      const summary: BackupSummary = {
        status,
        startTime,
        endTime,
        duration,
        totalFiles: fileResults.length,
        successfulUploads,
        failedUploads,
        totalSize,
        compressedSize,
        compressionRatio,
        files: fileResults,
        errors
      };

      // Send notifications
      await this.sendNotifications(summary, finalConfig.notifications);

      // Clean up temporary files
      await this.cleanupFiles(exportResults);

      console.log(`✅ Backup process completed: ${status}`);
      console.log(`📊 Duration: ${Math.round(duration / 1000)}s`);
      console.log(`📁 Files processed: ${successfulUploads}/${fileResults.length}`);

      return {
        success: status !== 'failure',
        summary,
        errors
      };

    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      
      const errorMessage = `Backup process failed: ${(error as Error)?.message || String(error)}`;
      errors.push(errorMessage);
      
      console.error('❌ Backup process failed:', error);

      // Create failure summary
      const summary: BackupSummary = {
        status: 'failure',
        startTime,
        endTime,
        duration,
        totalFiles: 0,
        successfulUploads: 0,
        failedUploads: 0,
        totalSize: 0,
        compressedSize: 0,
        compressionRatio: 1,
        files: [],
        errors
      };

      // Send failure notification
      try {
        await this.sendNotifications(summary, finalConfig.notifications);
      } catch (notificationError) {
        console.error('❌ Failed to send failure notification:', notificationError);
      }

      return {
        success: false,
        summary,
        errors
      };
    }
  }

  /**
   * Initialize all required services
   */
  private static async initializeServices(): Promise<void> {
    console.log('🔧 Initializing services...');

    try {
      // Initialize Supabase client
      console.log('🔌 Connecting to Supabase...');
      await supabaseClient.getAllTableNames();
      console.log('✅ Supabase connection verified');

      // Initialize Google Drive OAuth
      console.log('🔌 Initializing Google Drive...');
      
      // Load OAuth tokens from file
      const tokens = await DriveUploaderOAuth.loadTokens('./oauth-tokens.json');
      if (!tokens) {
        throw new Error('OAuth tokens not found. Run OAuth setup first.');
      }
      
      // Set credentials with parent folder ID
      DriveUploaderOAuth.setCredentials({
        clientId: process.env.OATH_CLIENT_ID || '',
        clientSecret: process.env.OATH_CLIENT_SECRET || '',
        redirectUri: 'urn:ietf:wg:oauth:2.0:oob',
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken
      }, process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || '');
      
      await DriveUploaderOAuth.initializeOAuthClient();
      console.log('✅ Google Drive OAuth initialized');

      // Initialize Email Service
      console.log('🔌 Initializing email service...');
      await EmailService.initializeFromEnv();
      console.log('✅ Email service initialized');

    } catch (error) {
      console.error('❌ Service initialization failed:', error);
      throw new Error(`Service initialization failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Export data in all requested formats
   */
  private static async exportData(config: BackupConfig): Promise<FileExportResult[]> {
    console.log('📤 Exporting database...');
    
    const exporter = new DatabaseExporter();
    const results: FileExportResult[] = [];
    
    // First get database metadata
    const metadata = await exporter.discoverDatabase();
    
    for (const format of config.formats) {
      try {
        console.log(`📄 Exporting ${format.toUpperCase()} format...`);
        
        let content: string | Buffer;
        let filename: string;
        
        switch (format) {
          case 'sql':
            content = await SqlExporter.generateSqlDump(metadata);
            filename = FileManager.generateFilename('gym_database_backup', 'sql', {
              includeTimestamp: true,
              includeFormat: true,
              includeCompression: config.compression,
              timestampFormat: 'yyyy-MM-dd_HH-mm-ss',
              separator: '_'
            });
            break;
          case 'json':
            const allData = await exporter.exportAllTableData();
            content = await JsonExporter.generateJsonBackup(metadata, allData);
            filename = FileManager.generateFilename('gym_database_backup', 'json', {
              includeTimestamp: true,
              includeFormat: true,
              includeCompression: config.compression,
              timestampFormat: 'yyyy-MM-dd_HH-mm-ss',
              separator: '_'
            });
            break;
          case 'xlsx':
            const tableData = await exporter.exportAllTableData();
            content = await ExcelExporter.generateExcelBackup(metadata, tableData);
            filename = FileManager.generateFilename('gym_database_backup', 'xlsx', {
              includeTimestamp: true,
              includeFormat: true,
              includeCompression: config.compression,
              timestampFormat: 'yyyy-MM-dd_HH-mm-ss',
              separator: '_'
            });
            break;
          default:
            throw new Error(`Unsupported format: ${format}`);
        }
        
        // Create backup file (Excel files should never be compressed)
        const shouldCompress = config.compression && format !== 'xlsx';
        
        const fileResult = await FileManager.createBackupFile(
          content, 
          'gym_database_backup',
          format,
          {
            enabled: shouldCompress,
            level: 6,
            algorithm: 'gzip'
          },
          {
            includeTimestamp: true,
            includeFormat: true,
            includeCompression: shouldCompress,
            timestampFormat: 'yyyy-MM-dd_HH-mm-ss',
            separator: '_'
          }
        );
        
        // Save file to local filesystem
        const filePath = await FileManager.saveToLocal(
          fileResult.content,
          fileResult.metadata,
          config.outputDirectory
        );
        
        const exportResult: FileExportResult = {
          filename: fileResult.metadata.filename,
          filePath,
          format,
          size: fileResult.metadata.originalSize,
          compressed: fileResult.metadata.compressed,
          ...(fileResult.metadata.compressedSize && { compressedSize: fileResult.metadata.compressedSize }),
          checksum: fileResult.metadata.checksum
        };
        
        results.push(exportResult);
        console.log(`✅ ${format.toUpperCase()} export completed: ${fileResult.metadata.filename}`);
        
      } catch (error) {
        console.error(`❌ ${format.toUpperCase()} export failed:`, error);
        throw new Error(`${format.toUpperCase()} export failed: ${(error as Error)?.message || String(error)}`);
      }
    }
    
    return results;
  }

  /**
   * Upload files to Google Drive
   */
  private static async uploadFiles(
    fileMetadata: FileExportResult[],
    config: BackupConfig
  ): Promise<Array<{ success: boolean; result?: OAuthDriveUploadResult; error?: string }>> {
    console.log('☁️  Uploading files to Google Drive...');
    
    const results: Array<{ success: boolean; result?: OAuthDriveUploadResult; error?: string }> = [];
    
    for (const metadata of fileMetadata) {
      try {
        console.log(`⬆️  Uploading: ${metadata.filename}`);
        
        // Read file content
        const content = await fs.readFile(metadata.filePath);
        
        // Create file metadata for upload
        const uploadMetadata: FileMetadata = {
          filename: metadata.filename,
          originalSize: metadata.size,
          ...(metadata.compressedSize && { compressedSize: metadata.compressedSize }),
          compressionRatio: metadata.compressedSize ? metadata.size / metadata.compressedSize : 1,
          checksum: metadata.checksum,
          createdAt: formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss'),
          format: metadata.format,
          compressed: metadata.compressed
        };
        
        // Upload to Google Drive (will use the configured parent folder)
        const uploadOptions: any = {
          createDateFolders: true,
          retryAttempts: config.retryAttempts,
          verifyUpload: true
        };
        
        if (process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID) {
          uploadOptions.parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
        }
        
        const uploadResult = await DriveUploaderOAuth.uploadFile(content, uploadMetadata, uploadOptions);
        
        results.push({ success: true, result: uploadResult });
        console.log(`✅ Upload completed: ${metadata.filename}`);
        
      } catch (error) {
        const errorMessage = `Upload failed: ${(error as Error)?.message || String(error)}`;
        console.error(`❌ Upload failed for ${metadata.filename}:`, error);
        results.push({ success: false, error: errorMessage });
      }
    }
    
    return results;
  }

  /**
   * Send appropriate notifications based on backup status
   */
  private static async sendNotifications(summary: BackupSummary, options: NotificationOptions): Promise<void> {
    if (!options.recipients || options.recipients.length === 0) {
      console.log('ℹ️  No notification recipients configured, skipping notifications');
      return;
    }

    try {
      console.log('📧 Sending notifications...');
      
      switch (summary.status) {
        case 'success':
          await EmailService.sendSuccessNotification(summary, options);
          break;
        case 'partial':
          await EmailService.sendPartialNotification(summary, options);
          break;
        case 'failure':
          await EmailService.sendFailureNotification(summary, options);
          break;
      }
      
      console.log('✅ Notifications sent successfully');
    } catch (error) {
      console.error('❌ Failed to send notifications:', error);
      // Don't throw error for notification failures
    }
  }

  /**
   * Clean up temporary files
   */
  private static async cleanupFiles(fileMetadata: FileExportResult[]): Promise<void> {
    console.log('🧹 Cleaning up temporary files...');
    
    for (const metadata of fileMetadata) {
      try {
        await fs.unlink(metadata.filePath);
        console.log(`🗑️  Deleted: ${metadata.filename}`);
      } catch (error) {
        console.warn(`⚠️  Failed to delete ${metadata.filename}:`, error);
      }
    }
  }

  /**
   * Create backup configuration from environment variables
   */
  public static createConfigFromEnv(): BackupConfig {
    const recipients = process.env.EMAIL_TO ? 
      process.env.EMAIL_TO.split(',').map(email => email.trim()) : 
      [process.env.EMAIL_USER].filter(Boolean) as string[];

    return {
      formats: (process.env.BACKUP_FORMATS?.split(',') as ('sql' | 'json' | 'xlsx')[]) || ['sql', 'json'],
      compression: process.env.BACKUP_COMPRESSION !== 'false',
      notifications: {
        sendOnSuccess: process.env.NOTIFICATION_ON_SUCCESS !== 'false',
        sendOnFailure: process.env.NOTIFICATION_ON_FAILURE !== 'false',
        sendOnPartial: process.env.NOTIFICATION_ON_PARTIAL !== 'false',
        recipients,
        includeDetails: process.env.NOTIFICATION_INCLUDE_DETAILS !== 'false',
        includeLogs: process.env.NOTIFICATION_INCLUDE_LOGS === 'true'
      },
      retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
      outputDirectory: process.env.BACKUP_OUTPUT_DIR || './backup-files'
    };
  }
}

// Export convenience function
export const executeBackup = BackupOrchestrator.executeBackup.bind(BackupOrchestrator);
export const createConfigFromEnv = BackupOrchestrator.createConfigFromEnv.bind(BackupOrchestrator);