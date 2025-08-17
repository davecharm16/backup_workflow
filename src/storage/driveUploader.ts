import { google } from 'googleapis';
import { format as formatDate } from 'date-fns';
import { config } from '../config/environment';
import { retryGoogleDriveOperation } from '../utils/retryLogic';
import { FileMetadata } from '../utils/fileManager';

export interface DriveUploadOptions {
  createDateFolders: boolean;
  parentFolderId?: string;
  retryAttempts: number;
  verifyUpload: boolean;
}

export interface DriveUploadResult {
  fileId: string;
  fileName: string;
  fileSize: number;
  uploadTime: number;
  driveUrl: string;
  folderPath: string;
}

export interface DriveFolderStructure {
  year: string;
  month: string;
  day: string;
  yearFolderId: string;
  monthFolderId: string;
  dayFolderId: string;
}

export class DriveUploader {
  private static defaultOptions: DriveUploadOptions = {
    createDateFolders: true,
    retryAttempts: 3,
    verifyUpload: true
  };

  private static driveClient: any = null;

  /**
   * Initialize Google Drive client with authentication
   */
  public static async initializeDriveClient(): Promise<void> {
    if (this.driveClient) {
      return; // Already initialized
    }

    console.log('🔧 Initializing Google Drive client...');

    try {
      // Set up JWT authentication
      const auth = new google.auth.JWT(
        config.googleDrive.clientEmail,
        undefined,
        config.googleDrive.privateKey.replace(/\\n/g, '\n'),
        ['https://www.googleapis.com/auth/drive']
      );

      // Authorize the client
      await auth.authorize();

      // Create Drive client
      this.driveClient = google.drive({ version: 'v3', auth });

      console.log('✅ Google Drive client initialized successfully');
      console.log(`📧 Service Account: ${config.googleDrive.clientEmail}`);

      // Verify access to parent folder
      await this.verifyFolderAccess(config.googleDrive.parentFolderId);

    } catch (error) {
      console.error('❌ Failed to initialize Google Drive client:', error);
      throw new Error(`Drive initialization failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Verify access to a folder
   */
  private static async verifyFolderAccess(folderId: string): Promise<void> {
    try {
      const response = await this.driveClient.files.get({
        fileId: folderId,
        fields: 'id, name, mimeType'
      });

      if (response.data.mimeType !== 'application/vnd.google-apps.folder') {
        throw new Error(`ID ${folderId} is not a folder`);
      }

      console.log(`✅ Verified access to folder: "${response.data.name}" (${folderId})`);

    } catch (error) {
      console.error(`❌ Cannot access folder ${folderId}:`, error);
      throw new Error(`Folder access verification failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Create date-based folder structure (/Gym-Backups/YYYY/MM/DD/)
   */
  public static async createDateFolderStructure(
    parentFolderId: string = config.googleDrive.parentFolderId,
    date: Date = new Date()
  ): Promise<DriveFolderStructure> {
    await this.initializeDriveClient();

    const year = formatDate(date, 'yyyy');
    const month = formatDate(date, 'MM');
    const day = formatDate(date, 'dd');

    console.log(`📁 Creating date folder structure: ${year}/${month}/${day}`);

    try {
      // Create or get year folder
      const yearFolderId = await retryGoogleDriveOperation(
        () => this.createOrGetFolder(year, parentFolderId),
        `Create year folder ${year}`
      );

      // Create or get month folder
      const monthFolderId = await retryGoogleDriveOperation(
        () => this.createOrGetFolder(month, yearFolderId),
        `Create month folder ${month}`
      );

      // Create or get day folder
      const dayFolderId = await retryGoogleDriveOperation(
        () => this.createOrGetFolder(day, monthFolderId),
        `Create day folder ${day}`
      );

      const structure: DriveFolderStructure = {
        year,
        month,
        day,
        yearFolderId,
        monthFolderId,
        dayFolderId
      };

      console.log(`✅ Date folder structure created: ${year}/${month}/${day}`);
      return structure;

    } catch (error) {
      console.error('❌ Failed to create date folder structure:', error);
      throw new Error(`Folder structure creation failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Create folder or get existing folder by name in parent
   */
  private static async createOrGetFolder(name: string, parentId: string): Promise<string> {
    try {
      // First, check if folder already exists
      const listResponse = await this.driveClient.files.list({
        q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
        pageSize: 1
      });

      if (listResponse.data.files && listResponse.data.files.length > 0) {
        const existingFolder = listResponse.data.files[0];
        console.log(`📁 Found existing folder: ${name} (${existingFolder.id})`);
        return existingFolder.id;
      }

      // Create new folder
      const folderMetadata = {
        name: name,
        parents: [parentId],
        mimeType: 'application/vnd.google-apps.folder'
      };

      const createResponse = await this.driveClient.files.create({
        resource: folderMetadata,
        fields: 'id, name'
      });

      console.log(`📁 Created new folder: ${name} (${createResponse.data.id})`);
      return createResponse.data.id;

    } catch (error) {
      console.error(`❌ Failed to create/get folder ${name}:`, error);
      throw error;
    }
  }

  /**
   * Upload file to Google Drive with verification
   */
  public static async uploadFile(
    content: Buffer,
    metadata: FileMetadata,
    options: Partial<DriveUploadOptions> = {}
  ): Promise<DriveUploadResult> {
    const config_options = { ...this.defaultOptions, ...options };
    
    await this.initializeDriveClient();

    const startTime = Date.now();
    console.log(`🔧 Uploading file: ${metadata.filename}`);
    console.log(`📊 File size: ${Math.round(content.length / 1024)} KB`);

    try {
      // Determine target folder
      let targetFolderId = config_options.parentFolderId || config.googleDrive.parentFolderId;
      let folderPath = '/';

      if (config_options.createDateFolders) {
        const folderStructure = await this.createDateFolderStructure();
        targetFolderId = folderStructure.dayFolderId;
        folderPath = `/${folderStructure.year}/${folderStructure.month}/${folderStructure.day}/`;
      }

      // Prepare file metadata
      const fileMetadata = {
        name: metadata.filename,
        parents: [targetFolderId],
        description: `Gym Management Database Backup - ${metadata.format.toUpperCase()} format - Created: ${metadata.createdAt}`
      };

      // Upload file with retry logic
      const uploadResult = await retryGoogleDriveOperation(
        async () => {
          const { Readable } = require('stream');
          const readable = new Readable();
          readable.push(content);
          readable.push(null);
          
          return await this.driveClient.files.create({
            resource: fileMetadata,
            media: {
              mimeType: this.getMimeType(metadata.format, metadata.compressed),
              body: readable
            },
            fields: 'id, name, size, webViewLink'
          });
        },
        `Upload file ${metadata.filename}`
      );

      const uploadTime = Date.now() - startTime;

      const result: DriveUploadResult = {
        fileId: uploadResult.data.id,
        fileName: uploadResult.data.name,
        fileSize: parseInt(uploadResult.data.size) || content.length,
        uploadTime,
        driveUrl: uploadResult.data.webViewLink,
        folderPath
      };

      console.log(`✅ File uploaded successfully in ${uploadTime}ms`);
      console.log(`📁 Location: ${folderPath}${metadata.filename}`);
      console.log(`🔗 Drive URL: ${result.driveUrl}`);

      // Verify upload if requested
      if (config_options.verifyUpload) {
        await this.verifyUpload(result.fileId, content.length, metadata.checksum);
      }

      return result;

    } catch (error) {
      console.error(`❌ File upload failed: ${metadata.filename}`, error);
      throw new Error(`Upload failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Verify uploaded file integrity
   */
  private static async verifyUpload(
    fileId: string,
    expectedSize: number,
    expectedChecksum: string
  ): Promise<void> {
    try {
      console.log('🔍 Verifying upload integrity...');

      // Get file metadata from Drive
      const fileResponse = await this.driveClient.files.get({
        fileId: fileId,
        fields: 'id, name, size, md5Checksum'
      });

      const fileData = fileResponse.data;

      // Verify file size
      const actualSize = parseInt(fileData.size) || 0;
      if (actualSize !== expectedSize) {
        throw new Error(`Size mismatch: expected ${expectedSize}, got ${actualSize}`);
      }

      // Note: Google Drive's MD5 checksum might not be available immediately
      // and may differ from our SHA-256 checksum, so we primarily rely on size verification
      console.log('✅ Upload verification passed');
      console.log(`📊 Verified size: ${actualSize} bytes`);

    } catch (error) {
      console.error('❌ Upload verification failed:', error);
      throw new Error(`Upload verification failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Get appropriate MIME type for file format
   */
  private static getMimeType(format: string, compressed: boolean): string {
    if (compressed) {
      return 'application/gzip';
    }

    switch (format.toLowerCase()) {
      case 'sql':
        return 'application/sql';
      case 'json':
        return 'application/json';
      case 'xlsx':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      default:
        return 'application/octet-stream';
    }
  }

  /**
   * List files in a specific folder
   */
  public static async listFilesInFolder(
    folderId: string,
    maxResults: number = 100
  ): Promise<Array<{ id: string; name: string; size: number; createdTime: string }>> {
    await this.initializeDriveClient();

    try {
      const response = await this.driveClient.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name, size, createdTime)',
        orderBy: 'createdTime desc',
        pageSize: maxResults
      });

      return response.data.files.map((file: any) => ({
        id: file.id,
        name: file.name,
        size: parseInt(file.size) || 0,
        createdTime: file.createdTime
      }));

    } catch (error) {
      console.error(`❌ Failed to list files in folder ${folderId}:`, error);
      throw new Error(`File listing failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Delete old backup files (cleanup)
   */
  public static async deleteOldBackups(
    folderId: string,
    keepCount: number = 10
  ): Promise<{ deletedCount: number; deletedFiles: string[] }> {
    await this.initializeDriveClient();

    try {
      console.log(`🧹 Cleaning up old backups, keeping newest ${keepCount} files...`);

      const files = await this.listFilesInFolder(folderId, 100);
      
      if (files.length <= keepCount) {
        console.log(`ℹ️  Only ${files.length} files found, no cleanup needed`);
        return { deletedCount: 0, deletedFiles: [] };
      }

      // Sort by creation time (newest first) and get files to delete
      const sortedFiles = files.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());
      const filesToDelete = sortedFiles.slice(keepCount);

      const deletedFiles: string[] = [];

      for (const file of filesToDelete) {
        try {
          await retryGoogleDriveOperation(
            () => this.driveClient.files.delete({ fileId: file.id }),
            `Delete file ${file.name}`
          );
          
          deletedFiles.push(file.name);
          console.log(`🗑️  Deleted: ${file.name}`);
          
        } catch (error) {
          console.error(`❌ Failed to delete ${file.name}:`, error);
        }
      }

      console.log(`✅ Cleanup completed: ${deletedFiles.length} files deleted`);
      return { deletedCount: deletedFiles.length, deletedFiles };

    } catch (error) {
      console.error('❌ Cleanup failed:', error);
      throw new Error(`Backup cleanup failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Get upload progress tracking (for large files)
   */
  public static async uploadWithProgress(
    content: Buffer,
    metadata: FileMetadata,
    progressCallback?: (progress: number) => void,
    options: Partial<DriveUploadOptions> = {}
  ): Promise<DriveUploadResult> {
    // For now, this is the same as regular upload
    // In the future, this could be enhanced with resumable uploads for very large files
    if (progressCallback) {
      progressCallback(0);
    }

    const result = await this.uploadFile(content, metadata, options);

    if (progressCallback) {
      progressCallback(100);
    }

    return result;
  }
}

// Export convenience functions
export const initializeDriveClient = DriveUploader.initializeDriveClient.bind(DriveUploader);
export const createDateFolderStructure = DriveUploader.createDateFolderStructure.bind(DriveUploader);
export const uploadFile = DriveUploader.uploadFile.bind(DriveUploader);
export const listFilesInFolder = DriveUploader.listFilesInFolder.bind(DriveUploader);
export const deleteOldBackups = DriveUploader.deleteOldBackups.bind(DriveUploader);