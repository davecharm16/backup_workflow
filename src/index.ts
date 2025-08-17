#!/usr/bin/env node

import { BackupOrchestrator } from './core/backupOrchestrator';
import { config } from './config/environment';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Main entry point for the backup system
 */
async function main() {
  console.log('🏋️  Gym Management Database Backup System');
  console.log('========================================\n');

  try {
    // Load configuration from environment
    const backupConfig = BackupOrchestrator.createConfigFromEnv();
    
    console.log('📋 Backup Configuration:');
    console.log(`   Formats: ${backupConfig.formats.join(', ')}`);
    console.log(`   Compression: ${backupConfig.compression ? 'Enabled' : 'Disabled'}`);
    console.log(`   Recipients: ${backupConfig.notifications.recipients.join(', ')}`);
    console.log(`   Output Directory: ${backupConfig.outputDirectory}`);
    console.log(`   Retry Attempts: ${backupConfig.retryAttempts}\n`);

    // Execute backup
    const result = await BackupOrchestrator.executeBackup(backupConfig);

    // Report results
    console.log('\n📊 Backup Results:');
    console.log(`   Status: ${result.summary.status.toUpperCase()}`);
    console.log(`   Duration: ${Math.round(result.summary.duration / 1000)}s`);
    console.log(`   Files: ${result.summary.successfulUploads}/${result.summary.totalFiles}`);
    console.log(`   Total Size: ${Math.round(result.summary.totalSize / 1024)} KB`);
    console.log(`   Compressed Size: ${Math.round(result.summary.compressedSize / 1024)} KB`);
    console.log(`   Compression Ratio: ${result.summary.compressionRatio.toFixed(2)}x`);

    if (result.summary.files.length > 0) {
      console.log('\n📁 Files:');
      result.summary.files.forEach(file => {
        const status = file.uploadStatus === 'success' ? '✅' : '❌';
        console.log(`   ${status} ${file.filename} (${file.format.toUpperCase()})`);
        if (file.driveUrl) {
          console.log(`      🔗 ${file.driveUrl}`);
        }
        if (file.error) {
          console.log(`      ❌ ${file.error}`);
        }
      });
    }

    if (result.errors.length > 0) {
      console.log('\n❌ Errors:');
      result.errors.forEach(error => {
        console.log(`   • ${error}`);
      });
    }

    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);

  } catch (error) {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  }
}

// Handle CLI arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🏋️  Gym Management Database Backup System

Usage: npm start [options]

Options:
  --help, -h     Show this help message
  --test         Run in test mode (dry run)
  --config       Show current configuration

Environment Variables:
  SUPABASE_URL              Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY Supabase service role key
  
  EMAIL_SERVICE             Email service (default: gmail)
  EMAIL_USER                Email username
  EMAIL_PASSWORD            Email password (app password for Gmail)
  EMAIL_TO                  Notification recipients (comma-separated)
  
  OATH_CLIENT_ID            Google OAuth client ID
  OATH_CLIENT_SECRET        Google OAuth client secret
  
  BACKUP_FORMATS            Export formats: sql,json,xlsx (default: sql,json)
  BACKUP_COMPRESSION        Enable compression (default: true)
  BACKUP_OUTPUT_DIR         Output directory (default: ./backup-files)
  
  NOTIFICATION_ON_SUCCESS   Send success notifications (default: true)
  NOTIFICATION_ON_FAILURE   Send failure notifications (default: true)
  NOTIFICATION_ON_PARTIAL   Send partial success notifications (default: true)
  NOTIFICATION_INCLUDE_DETAILS Include file details (default: true)
  
  RETRY_ATTEMPTS            Number of retry attempts (default: 3)

Examples:
  npm start                 Run backup with default settings
  npm start --config        Show current configuration
  npm run test              Run test backup
`);
  process.exit(0);
}

if (args.includes('--config')) {
  console.log('📋 Current Configuration:');
  const config = BackupOrchestrator.createConfigFromEnv();
  console.log(JSON.stringify(config, null, 2));
  process.exit(0);
}

if (args.includes('--test')) {
  console.log('🧪 Running in test mode...\n');
  // Set test mode environment variable
  process.env.TEST_MODE = 'true';
}

// Run main function
main().catch(error => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});