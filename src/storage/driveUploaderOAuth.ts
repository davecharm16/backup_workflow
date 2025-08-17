import { google } from 'googleapis';
import { format as formatDate } from 'date-fns';
import { retryGoogleDriveOperation } from '../utils/retryLogic';
import { FileMetadata } from '../utils/fileManager';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface OAuthDriveUploadOptions {
  createDateFolders: boolean;
  parentFolderId?: string;
  retryAttempts: number;
  verifyUpload: boolean;
}

export interface OAuthDriveUploadResult {
  fileId: string;
  fileName: string;
  fileSize: number;
  uploadTime: number;
  driveUrl: string;
  folderPath: string;
}

export interface OAuthDriveFolderStructure {
  year: string;
  month: string;
  day: string;
  yearFolderId: string;
  monthFolderId: string;
  dayFolderId: string;
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken?: string;
  accessToken?: string;
}

export class DriveUploaderOAuth {
  private static defaultOptions: OAuthDriveUploadOptions = {
    createDateFolders: true,
    retryAttempts: 3,
    verifyUpload: true
  };

  private static oAuth2Client: any = null;
  private static credentials: OAuthCredentials | null = null;
  private static parentFolderId: string = '';

  /**
   * Initialize OAuth credentials from environment or config
   */
  public static setCredentials(credentials: OAuthCredentials, parentFolderId: string = ''): void {
    this.credentials = credentials;
    this.parentFolderId = parentFolderId;
    console.log('✅ OAuth credentials set');
  }

  /**
   * Initialize Google Drive OAuth client
   */
  public static async initializeOAuthClient(): Promise<void> {
    if (!this.credentials) {
      throw new Error('OAuth credentials not set. Call setCredentials() first.');
    }

    console.log('🔧 Initializing Google Drive OAuth client...');

    try {
      // Create OAuth2 client
      this.oAuth2Client = new google.auth.OAuth2(
        this.credentials.clientId,
        this.credentials.clientSecret,
        this.credentials.redirectUri
      );

      // Set credentials if we have them
      if (this.credentials.refreshToken) {
        this.oAuth2Client.setCredentials({
          refresh_token: this.credentials.refreshToken,
          access_token: this.credentials.accessToken
        });

        // Test the credentials
        await this.oAuth2Client.getAccessToken();
        console.log('✅ OAuth client initialized with existing tokens');
      } else {
        console.log('⚠️  No refresh token found. Authorization required.');
      }

    } catch (error) {
      console.error('❌ Failed to initialize OAuth client:', error);
      throw new Error(`OAuth initialization failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Get authorization URL for OAuth flow
   */
  public static getAuthUrl(): string {
    if (!this.oAuth2Client) {
      throw new Error('OAuth client not initialized. Call initializeOAuthClient() first.');
    }

    const scopes = ['https://www.googleapis.com/auth/drive.file'];
    
    const authUrl = this.oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent' // Forces refresh token generation
    });

    return authUrl;
  }

  /**
   * Exchange authorization code for tokens
   */
  public static async exchangeCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string }> {
    if (!this.oAuth2Client) {
      throw new Error('OAuth client not initialized. Call initializeOAuthClient() first.');
    }

    try {
      const { tokens } = await this.oAuth2Client.getToken(code);
      
      this.oAuth2Client.setCredentials(tokens);

      console.log('✅ OAuth tokens exchanged successfully');
      
      return {
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token!
      };
    } catch (error) {
      console.error('❌ Failed to exchange code for tokens:', error);
      throw new Error(`Token exchange failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Save tokens to file for persistence
   */
  public static async saveTokens(tokens: { accessToken: string; refreshToken: string }, filePath: string = './oauth-tokens.json'): Promise<void> {
    try {
      const tokenData = {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        created_at: new Date().toISOString()
      };

      await fs.writeFile(filePath, JSON.stringify(tokenData, null, 2));
      console.log(`✅ Tokens saved to ${filePath}`);
    } catch (error) {
      console.error('❌ Failed to save tokens:', error);
      throw new Error(`Token save failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Load tokens from file
   */
  public static async loadTokens(filePath: string = './oauth-tokens.json'): Promise<{ accessToken: string; refreshToken: string } | null> {
    try {
      const tokenData = await fs.readFile(filePath, 'utf-8');
      const tokens = JSON.parse(tokenData);
      
      console.log(`✅ Tokens loaded from ${filePath}`);
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token
      };
    } catch (error) {
      console.log(`ℹ️  No existing tokens found at ${filePath}`);
      return null;
    }
  }

  /**
   * Get Drive client with OAuth authentication
   */
  private static getDriveClient(): any {
    if (!this.oAuth2Client) {
      throw new Error('OAuth client not initialized');
    }

    return google.drive({ version: 'v3', auth: this.oAuth2Client });
  }

  /**
   * Verify folder access with OAuth
   */
  private static async verifyFolderAccess(folderId: string): Promise<void> {
    try {
      const drive = this.getDriveClient();
      const response = await drive.files.get({
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
   * Create date-based folder structure
   */
  public static async createDateFolderStructure(
    parentFolderId: string = this.parentFolderId,
    date: Date = new Date()
  ): Promise<OAuthDriveFolderStructure> {
    if (!this.oAuth2Client) {
      throw new Error('OAuth client not initialized');
    }

    const year = formatDate(date, 'yyyy');
    const month = formatDate(date, 'MM');
    const day = formatDate(date, 'dd');

    console.log(`📁 Creating date folder structure: ${year}/${month}/${day}`);

    try {
      // If no parent folder specified, create in root
      let targetParentId = parentFolderId;
      if (!targetParentId) {
        console.log('ℹ️  No parent folder specified, using root drive');
        targetParentId = 'root';
      }

      // Create or get year folder
      const yearFolderId = await retryGoogleDriveOperation(
        () => this.createOrGetFolder(year, targetParentId),
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

      const structure: OAuthDriveFolderStructure = {
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
      const drive = this.getDriveClient();

      // First, check if folder already exists
      const listResponse = await drive.files.list({
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

      const createResponse = await drive.files.create({
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
   * Upload file to Google Drive with OAuth
   */
  public static async uploadFile(
    content: Buffer,
    metadata: FileMetadata,
    options: Partial<OAuthDriveUploadOptions> = {}
  ): Promise<OAuthDriveUploadResult> {
    const config = { ...this.defaultOptions, ...options };
    
    if (!this.oAuth2Client) {
      throw new Error('OAuth client not initialized');
    }

    const startTime = Date.now();
    console.log(`🔧 Uploading file: ${metadata.filename}`);
    console.log(`📊 File size: ${Math.round(content.length / 1024)} KB`);

    try {
      // Determine target folder
      let targetFolderId = config.parentFolderId || this.parentFolderId || 'root';
      let folderPath = '/';

      if (config.createDateFolders) {
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
          
          const drive = this.getDriveClient();
          return await drive.files.create({
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

      const result: OAuthDriveUploadResult = {
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
      if (config.verifyUpload) {
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

      const drive = this.getDriveClient();
      const fileResponse = await drive.files.get({
        fileId: fileId,
        fields: 'id, name, size, md5Checksum'
      });

      const fileData = fileResponse.data;

      // Verify file size
      const actualSize = parseInt(fileData.size) || 0;
      if (actualSize !== expectedSize) {
        throw new Error(`Size mismatch: expected ${expectedSize}, got ${actualSize}`);
      }

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
    if (!this.oAuth2Client) {
      throw new Error('OAuth client not initialized');
    }

    try {
      const drive = this.getDriveClient();
      const response = await drive.files.list({
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
}

// Export convenience functions
export const initializeOAuthClient = DriveUploaderOAuth.initializeOAuthClient.bind(DriveUploaderOAuth);
export const getAuthUrl = DriveUploaderOAuth.getAuthUrl.bind(DriveUploaderOAuth);
export const exchangeCodeForTokens = DriveUploaderOAuth.exchangeCodeForTokens.bind(DriveUploaderOAuth);
export const uploadFileOAuth = DriveUploaderOAuth.uploadFile.bind(DriveUploaderOAuth);
export const createDateFolderStructureOAuth = DriveUploaderOAuth.createDateFolderStructure.bind(DriveUploaderOAuth);