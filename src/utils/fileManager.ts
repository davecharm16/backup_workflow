import { format as formatDate } from 'date-fns';
import * as zlib from 'zlib';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface FileMetadata {
  filename: string;
  originalSize: number;
  compressedSize?: number;
  compressionRatio?: number;
  checksum: string;
  createdAt: string;
  format: 'sql' | 'json' | 'xlsx';
  compressed: boolean;
}

export interface CompressionOptions {
  enabled: boolean;
  level: number; // 1-9, higher = better compression but slower
  algorithm: 'gzip' | 'deflate';
}

export interface FileNamingOptions {
  includeTimestamp: boolean;
  includeFormat: boolean;
  includeCompression: boolean;
  timestampFormat: string;
  separator: string;
}

export class FileManager {
  private static defaultCompressionOptions: CompressionOptions = {
    enabled: true,
    level: 6, // Balanced compression
    algorithm: 'gzip'
  };

  private static defaultNamingOptions: FileNamingOptions = {
    includeTimestamp: true,
    includeFormat: true,
    includeCompression: true,
    timestampFormat: 'yyyy-MM-dd_HH-mm-ss',
    separator: '_'
  };

  /**
   * Generate timestamped filename for backup files
   */
  public static generateFilename(
    baseName: string,
    format: 'sql' | 'json' | 'xlsx',
    options: Partial<FileNamingOptions> = {},
    compressed: boolean = false
  ): string {
    const config = { ...this.defaultNamingOptions, ...options };
    
    let filename = baseName;
    const parts: string[] = [filename];

    // Add timestamp if requested
    if (config.includeTimestamp) {
      const timestamp = formatDate(new Date(), config.timestampFormat);
      parts.push(timestamp);
    }

    // Add format if requested
    if (config.includeFormat) {
      parts.push(format);
    }

    // Add compression indicator if requested and file is compressed
    if (config.includeCompression && compressed) {
      parts.push('compressed');
    }

    // Join parts with separator
    const baseFilename = parts.join(config.separator);

    // Add appropriate extension
    let extension = `.${format}`;
    if (compressed) {
      extension += '.gz';
    }

    return baseFilename + extension;
  }

  /**
   * Compress file content using specified algorithm
   */
  public static async compressContent(
    content: string | Buffer,
    options: Partial<CompressionOptions> = {}
  ): Promise<{ compressed: Buffer; metadata: { originalSize: number; compressedSize: number; compressionRatio: number } }> {
    const config = { ...this.defaultCompressionOptions, ...options };
    
    if (!config.enabled) {
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
      return {
        compressed: buffer,
        metadata: {
          originalSize: buffer.length,
          compressedSize: buffer.length,
          compressionRatio: 1.0
        }
      };
    }

    console.log('🗜️  Compressing content...');
    const startTime = Date.now();

    const inputBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const originalSize = inputBuffer.length;

    let compressed: Buffer;

    try {
      if (config.algorithm === 'gzip') {
        compressed = await new Promise((resolve, reject) => {
          zlib.gzip(inputBuffer, { level: config.level }, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      } else if (config.algorithm === 'deflate') {
        compressed = await new Promise((resolve, reject) => {
          zlib.deflate(inputBuffer, { level: config.level }, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      } else {
        throw new Error(`Unsupported compression algorithm: ${config.algorithm}`);
      }

      const compressedSize = compressed.length;
      const compressionRatio = originalSize / compressedSize;
      const compressionTime = Date.now() - startTime;

      console.log(`✅ Content compressed in ${compressionTime}ms`);
      console.log(`📊 Original: ${Math.round(originalSize / 1024)} KB`);
      console.log(`📊 Compressed: ${Math.round(compressedSize / 1024)} KB`);
      console.log(`📊 Compression ratio: ${compressionRatio.toFixed(2)}x`);

      return {
        compressed,
        metadata: {
          originalSize,
          compressedSize,
          compressionRatio
        }
      };

    } catch (error) {
      console.error('❌ Compression failed:', error);
      throw new Error(`Compression failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Decompress file content
   */
  public static async decompressContent(
    compressedContent: Buffer,
    algorithm: 'gzip' | 'deflate' = 'gzip'
  ): Promise<Buffer> {
    console.log('📂 Decompressing content...');

    try {
      let decompressed: Buffer;

      if (algorithm === 'gzip') {
        decompressed = await new Promise((resolve, reject) => {
          zlib.gunzip(compressedContent, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      } else if (algorithm === 'deflate') {
        decompressed = await new Promise((resolve, reject) => {
          zlib.inflate(compressedContent, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      } else {
        throw new Error(`Unsupported decompression algorithm: ${algorithm}`);
      }

      console.log(`✅ Content decompressed (${Math.round(decompressed.length / 1024)} KB)`);
      return decompressed;

    } catch (error) {
      console.error('❌ Decompression failed:', error);
      throw new Error(`Decompression failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Calculate file checksum for integrity verification
   */
  public static calculateChecksum(content: string | Buffer, algorithm: string = 'sha256'): string {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    return crypto.createHash(algorithm).update(buffer).digest('hex');
  }

  /**
   * Verify file integrity using checksum
   */
  public static verifyChecksum(content: string | Buffer, expectedChecksum: string, algorithm: string = 'sha256'): boolean {
    const actualChecksum = this.calculateChecksum(content, algorithm);
    return actualChecksum === expectedChecksum;
  }

  /**
   * Create backup file with compression and metadata
   */
  public static async createBackupFile(
    content: string | Buffer,
    baseName: string,
    format: 'sql' | 'json' | 'xlsx',
    compressionOptions: Partial<CompressionOptions> = {},
    namingOptions: Partial<FileNamingOptions> = {}
  ): Promise<{ content: Buffer; metadata: FileMetadata }> {
    const compConfig = { ...this.defaultCompressionOptions, ...compressionOptions };
    
    console.log(`🔧 Creating backup file: ${baseName}.${format}`);

    // Compress content if enabled
    const compressionResult = await this.compressContent(content, compConfig);
    const finalContent = compressionResult.compressed;

    // Generate filename
    const filename = this.generateFilename(baseName, format, namingOptions, compConfig.enabled);

    // Calculate checksum
    const checksum = this.calculateChecksum(finalContent);

    // Create metadata
    const metadata: FileMetadata = {
      filename,
      originalSize: compressionResult.metadata.originalSize,
      checksum,
      createdAt: formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss'),
      format,
      compressed: compConfig.enabled
    };

    if (compConfig.enabled) {
      metadata.compressedSize = compressionResult.metadata.compressedSize;
      metadata.compressionRatio = compressionResult.metadata.compressionRatio;
    }

    console.log(`✅ Backup file created: ${filename}`);
    console.log(`📊 Checksum: ${checksum.substring(0, 16)}...`);

    return {
      content: finalContent,
      metadata
    };
  }

  /**
   * Save backup file to local filesystem (for testing/debugging)
   */
  public static async saveToLocal(
    content: Buffer,
    metadata: FileMetadata,
    outputDir: string = './backups'
  ): Promise<string> {
    try {
      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });

      const filePath = path.join(outputDir, metadata.filename);
      await fs.writeFile(filePath, content);

      console.log(`💾 File saved locally: ${filePath}`);
      console.log(`📊 File size: ${Math.round(content.length / 1024)} KB`);

      return filePath;

    } catch (error) {
      console.error('❌ Failed to save file locally:', error);
      throw new Error(`Failed to save file: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Create metadata summary file
   */
  public static async createMetadataSummary(
    backupFiles: FileMetadata[],
    outputDir: string = './backups'
  ): Promise<string> {
    try {
      const summary = {
        generatedAt: formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        totalFiles: backupFiles.length,
        totalOriginalSize: backupFiles.reduce((sum, file) => sum + file.originalSize, 0),
        totalCompressedSize: backupFiles.reduce((sum, file) => sum + (file.compressedSize || file.originalSize), 0),
        files: backupFiles.map(file => ({
          filename: file.filename,
          format: file.format,
          originalSize: file.originalSize,
          compressedSize: file.compressedSize,
          compressionRatio: file.compressionRatio,
          checksum: file.checksum,
          createdAt: file.createdAt,
          compressed: file.compressed
        }))
      };

      // Calculate overall compression ratio
      const overallRatio = summary.totalOriginalSize / summary.totalCompressedSize;

      const metadataContent = {
        ...summary,
        overallCompressionRatio: overallRatio,
        totalSavings: summary.totalOriginalSize - summary.totalCompressedSize,
        totalSavingsPercentage: ((summary.totalOriginalSize - summary.totalCompressedSize) / summary.totalOriginalSize * 100)
      };

      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });

      const metadataFilename = `backup_metadata_${formatDate(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.json`;
      const metadataPath = path.join(outputDir, metadataFilename);
      
      await fs.writeFile(metadataPath, JSON.stringify(metadataContent, null, 2));

      console.log(`📄 Metadata summary created: ${metadataPath}`);
      console.log(`📊 Overall compression: ${overallRatio.toFixed(2)}x (${metadataContent.totalSavingsPercentage.toFixed(1)}% savings)`);

      return metadataPath;

    } catch (error) {
      console.error('❌ Failed to create metadata summary:', error);
      throw new Error(`Failed to create metadata summary: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Validate backup file integrity
   */
  public static async validateBackupFile(
    content: Buffer,
    metadata: FileMetadata
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      // Verify checksum
      if (!this.verifyChecksum(content, metadata.checksum)) {
        errors.push('Checksum verification failed - file may be corrupted');
      }

      // Verify file size
      const actualSize = content.length;
      const expectedSize = metadata.compressed ? metadata.compressedSize : metadata.originalSize;
      
      if (expectedSize && actualSize !== expectedSize) {
        errors.push(`File size mismatch - expected ${expectedSize}, got ${actualSize}`);
      }

      // Test decompression if compressed
      if (metadata.compressed) {
        try {
          await this.decompressContent(content);
        } catch (error) {
          errors.push(`Decompression test failed: ${(error as Error)?.message || String(error)}`);
        }
      }

      const valid = errors.length === 0;

      if (valid) {
        console.log(`✅ Backup file validation passed: ${metadata.filename}`);
      } else {
        console.error(`❌ Backup file validation failed: ${metadata.filename}`);
        errors.forEach(error => console.error(`   - ${error}`));
      }

      return { valid, errors };

    } catch (error) {
      errors.push(`Validation error: ${(error as Error)?.message || String(error)}`);
      return { valid: false, errors };
    }
  }

  /**
   * Get file format from filename
   */
  public static getFileFormat(filename: string): 'sql' | 'json' | 'xlsx' | 'unknown' {
    const extension = path.extname(filename.replace(/\.gz$/, '')).toLowerCase();
    
    switch (extension) {
      case '.sql':
        return 'sql';
      case '.json':
        return 'json';
      case '.xlsx':
        return 'xlsx';
      default:
        return 'unknown';
    }
  }

  /**
   * Check if file is compressed based on extension
   */
  public static isCompressed(filename: string): boolean {
    return filename.endsWith('.gz');
  }
}

// Export utility functions
export const generateFilename = FileManager.generateFilename.bind(FileManager);
export const compressContent = FileManager.compressContent.bind(FileManager);
export const createBackupFile = FileManager.createBackupFile.bind(FileManager);
export const validateBackupFile = FileManager.validateBackupFile.bind(FileManager);