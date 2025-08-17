import * as nodemailer from 'nodemailer';
import { format as formatDate } from 'date-fns';

export interface EmailConfig {
  service: string;
  host?: string;
  port?: number;
  secure?: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export interface BackupSummary {
  status: 'success' | 'failure' | 'partial';
  startTime: Date;
  endTime: Date;
  duration: number;
  totalFiles: number;
  successfulUploads: number;
  failedUploads: number;
  totalSize: number;
  compressedSize: number;
  compressionRatio: number;
  files: Array<{
    filename: string;
    format: string;
    size: number;
    compressed: boolean;
    uploadStatus: 'success' | 'failed';
    driveUrl?: string;
    error?: string;
  }>;
  errors: string[];
}

export interface NotificationOptions {
  sendOnSuccess: boolean;
  sendOnFailure: boolean;
  sendOnPartial: boolean;
  recipients: string[];
  includeDetails: boolean;
  includeLogs: boolean;
}

export class EmailService {
  private static transporter: nodemailer.Transporter | null = null;
  private static emailConfig: EmailConfig | null = null;

  /**
   * Initialize email service with configuration
   */
  public static async initialize(emailConfig: EmailConfig): Promise<void> {
    this.emailConfig = emailConfig;

    console.log('📧 Initializing email service...');

    try {
      // Create transporter
      this.transporter = nodemailer.createTransport({
        service: emailConfig.service,
        host: emailConfig.host,
        port: emailConfig.port,
        secure: emailConfig.secure,
        auth: emailConfig.auth
      });

      // Verify connection
      await this.transporter!.verify();
      console.log('✅ Email service initialized successfully');
      console.log(`📧 Service: ${emailConfig.service}`);
      console.log(`📧 User: ${emailConfig.auth.user}`);

    } catch (error) {
      console.error('❌ Failed to initialize email service:', error);
      throw new Error(`Email service initialization failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Initialize from environment variables
   */
  public static async initializeFromEnv(): Promise<void> {
    const emailConfig: EmailConfig = {
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASSWORD || ''
      }
    };

    if (!emailConfig.auth.user || !emailConfig.auth.pass) {
      throw new Error('Email credentials not found in environment variables. Set EMAIL_USER and EMAIL_PASSWORD.');
    }

    await this.initialize(emailConfig);
  }

  /**
   * Send backup success notification
   */
  public static async sendSuccessNotification(
    summary: BackupSummary,
    options: NotificationOptions
  ): Promise<void> {
    if (!options.sendOnSuccess) {
      console.log('ℹ️  Success notifications disabled, skipping...');
      return;
    }

    console.log('📧 Sending backup success notification...');

    const subject = `✅ Gym Backup Successful - ${formatDate(summary.endTime, 'yyyy-MM-dd HH:mm')}`;
    const htmlContent = this.generateSuccessEmailHtml(summary, options);
    const textContent = this.generateSuccessEmailText(summary, options);

    await this.sendEmail(options.recipients, subject, textContent, htmlContent);
  }

  /**
   * Send backup failure notification
   */
  public static async sendFailureNotification(
    summary: BackupSummary,
    options: NotificationOptions
  ): Promise<void> {
    if (!options.sendOnFailure) {
      console.log('ℹ️  Failure notifications disabled, skipping...');
      return;
    }

    console.log('📧 Sending backup failure notification...');

    const subject = `❌ Gym Backup Failed - ${formatDate(summary.endTime, 'yyyy-MM-dd HH:mm')}`;
    const htmlContent = this.generateFailureEmailHtml(summary, options);
    const textContent = this.generateFailureEmailText(summary, options);

    await this.sendEmail(options.recipients, subject, textContent, htmlContent);
  }

  /**
   * Send partial success notification
   */
  public static async sendPartialNotification(
    summary: BackupSummary,
    options: NotificationOptions
  ): Promise<void> {
    if (!options.sendOnPartial) {
      console.log('ℹ️  Partial notifications disabled, skipping...');
      return;
    }

    console.log('📧 Sending backup partial success notification...');

    const subject = `⚠️ Gym Backup Partial Success - ${formatDate(summary.endTime, 'yyyy-MM-dd HH:mm')}`;
    const htmlContent = this.generatePartialEmailHtml(summary, options);
    const textContent = this.generatePartialEmailText(summary, options);

    await this.sendEmail(options.recipients, subject, textContent, htmlContent);
  }

  /**
   * Send email using configured transporter
   */
  private static async sendEmail(
    recipients: string[],
    subject: string,
    text: string,
    html: string
  ): Promise<void> {
    if (!this.transporter || !this.emailConfig) {
      throw new Error('Email service not initialized. Call initialize() first.');
    }

    try {
      const mailOptions = {
        from: `"Gym Backup System" <${this.emailConfig.auth.user}>`,
        to: recipients.join(', '),
        subject,
        text,
        html
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('✅ Email sent successfully');
      console.log(`📧 Message ID: ${info.messageId}`);
      console.log(`📧 Recipients: ${recipients.join(', ')}`);

    } catch (error) {
      console.error('❌ Failed to send email:', error);
      throw new Error(`Email sending failed: ${(error as Error)?.message || String(error)}`);
    }
  }

  /**
   * Generate success email HTML content
   */
  private static generateSuccessEmailHtml(summary: BackupSummary, options: NotificationOptions): string {
    const successfulFiles = summary.files.filter(f => f.uploadStatus === 'success');
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Backup Success</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; }
        .summary { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #4CAF50; }
        .file-list { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .file-item { padding: 8px 0; border-bottom: 1px solid #eee; }
        .file-item:last-child { border-bottom: none; }
        .success { color: #4CAF50; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✅ Backup Successful</h1>
            <p>Gym Management Database Backup</p>
        </div>
        
        <div class="content">
            <div class="summary">
                <h3>📊 Backup Summary</h3>
                <p><strong>Status:</strong> <span class="success">Success</span></p>
                <p><strong>Completed:</strong> ${formatDate(summary.endTime, 'PPP p')}</p>
                <p><strong>Duration:</strong> ${Math.round(summary.duration / 1000)}s</p>
                <p><strong>Files Backed Up:</strong> ${summary.successfulUploads}/${summary.totalFiles}</p>
                <p><strong>Total Size:</strong> ${Math.round(summary.totalSize / 1024)} KB</p>
                <p><strong>Compressed Size:</strong> ${Math.round(summary.compressedSize / 1024)} KB</p>
                <p><strong>Compression Ratio:</strong> ${summary.compressionRatio.toFixed(2)}x</p>
            </div>

            ${options.includeDetails ? `
            <div class="file-list">
                <h3>📁 Backup Files</h3>
                ${successfulFiles.map(file => `
                <div class="file-item">
                    <strong>${file.filename}</strong> (${file.format.toUpperCase()})
                    <br>Size: ${Math.round(file.size / 1024)} KB
                    ${file.compressed ? ' (Compressed)' : ''}
                    ${file.driveUrl ? `<br><a href="${file.driveUrl}">View in Google Drive</a>` : ''}
                </div>
                `).join('')}
            </div>
            ` : ''}

            <p>All backup files have been successfully uploaded to Google Drive and are ready for recovery if needed.</p>
        </div>
        
        <div class="footer">
            <p>Generated by Gym Backup System - ${formatDate(new Date(), 'PPP p')}</p>
        </div>
    </div>
</body>
</html>
    `;
  }

  /**
   * Generate success email text content
   */
  private static generateSuccessEmailText(summary: BackupSummary, options: NotificationOptions): string {
    const successfulFiles = summary.files.filter(f => f.uploadStatus === 'success');
    
    let text = `✅ BACKUP SUCCESSFUL

Gym Management Database Backup

📊 SUMMARY:
- Status: Success
- Completed: ${formatDate(summary.endTime, 'PPP p')}
- Duration: ${Math.round(summary.duration / 1000)}s
- Files Backed Up: ${summary.successfulUploads}/${summary.totalFiles}
- Total Size: ${Math.round(summary.totalSize / 1024)} KB
- Compressed Size: ${Math.round(summary.compressedSize / 1024)} KB
- Compression Ratio: ${summary.compressionRatio.toFixed(2)}x

`;

    if (options.includeDetails) {
      text += `📁 BACKUP FILES:
${successfulFiles.map(file => 
        `- ${file.filename} (${file.format.toUpperCase()}) - ${Math.round(file.size / 1024)} KB${file.compressed ? ' (Compressed)' : ''}`
      ).join('\n')}

`;
    }

    text += `All backup files have been successfully uploaded to Google Drive and are ready for recovery if needed.

Generated by Gym Backup System - ${formatDate(new Date(), 'PPP p')}`;

    return text;
  }

  /**
   * Generate failure email HTML content
   */
  private static generateFailureEmailHtml(summary: BackupSummary, _options: NotificationOptions): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Backup Failed</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f44336; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; }
        .summary { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #f44336; }
        .error-list { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .error-item { padding: 8px 0; border-bottom: 1px solid #eee; color: #f44336; }
        .error-item:last-child { border-bottom: none; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>❌ Backup Failed</h1>
            <p>Gym Management Database Backup</p>
        </div>
        
        <div class="content">
            <div class="summary">
                <h3>📊 Backup Summary</h3>
                <p><strong>Status:</strong> <span style="color: #f44336;">Failed</span></p>
                <p><strong>Failed At:</strong> ${formatDate(summary.endTime, 'PPP p')}</p>
                <p><strong>Duration:</strong> ${Math.round(summary.duration / 1000)}s</p>
                <p><strong>Files Attempted:</strong> ${summary.totalFiles}</p>
                <p><strong>Successful:</strong> ${summary.successfulUploads}</p>
                <p><strong>Failed:</strong> ${summary.failedUploads}</p>
            </div>

            <div class="error-list">
                <h3>❌ Errors</h3>
                ${summary.errors.map(error => `
                <div class="error-item">${error}</div>
                `).join('')}
            </div>

            <p><strong>Action Required:</strong> Please check the backup system and resolve the issues above.</p>
        </div>
        
        <div class="footer">
            <p>Generated by Gym Backup System - ${formatDate(new Date(), 'PPP p')}</p>
        </div>
    </div>
</body>
</html>
    `;
  }

  /**
   * Generate failure email text content
   */
  private static generateFailureEmailText(summary: BackupSummary, _options: NotificationOptions): string {
    return `❌ BACKUP FAILED

Gym Management Database Backup

📊 SUMMARY:
- Status: Failed
- Failed At: ${formatDate(summary.endTime, 'PPP p')}
- Duration: ${Math.round(summary.duration / 1000)}s
- Files Attempted: ${summary.totalFiles}
- Successful: ${summary.successfulUploads}
- Failed: ${summary.failedUploads}

❌ ERRORS:
${summary.errors.map(error => `- ${error}`).join('\n')}

ACTION REQUIRED: Please check the backup system and resolve the issues above.

Generated by Gym Backup System - ${formatDate(new Date(), 'PPP p')}`;
  }

  /**
   * Generate partial success email HTML content
   */
  private static generatePartialEmailHtml(summary: BackupSummary, options: NotificationOptions): string {
    const successfulFiles = summary.files.filter(f => f.uploadStatus === 'success');
    const failedFiles = summary.files.filter(f => f.uploadStatus === 'failed');
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Backup Partial Success</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #ff9800; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; }
        .summary { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #ff9800; }
        .file-list { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .file-item { padding: 8px 0; border-bottom: 1px solid #eee; }
        .file-item:last-child { border-bottom: none; }
        .success { color: #4CAF50; }
        .failed { color: #f44336; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⚠️ Backup Partial Success</h1>
            <p>Gym Management Database Backup</p>
        </div>
        
        <div class="content">
            <div class="summary">
                <h3>📊 Backup Summary</h3>
                <p><strong>Status:</strong> <span style="color: #ff9800;">Partial Success</span></p>
                <p><strong>Completed:</strong> ${formatDate(summary.endTime, 'PPP p')}</p>
                <p><strong>Duration:</strong> ${Math.round(summary.duration / 1000)}s</p>
                <p><strong>Successful:</strong> <span class="success">${summary.successfulUploads}</span></p>
                <p><strong>Failed:</strong> <span class="failed">${summary.failedUploads}</span></p>
                <p><strong>Total Size:</strong> ${Math.round(summary.totalSize / 1024)} KB</p>
            </div>

            ${successfulFiles.length > 0 ? `
            <div class="file-list">
                <h3>✅ Successful Backups</h3>
                ${successfulFiles.map(file => `
                <div class="file-item">
                    <strong>${file.filename}</strong> (${file.format.toUpperCase()})
                    <br>Size: ${Math.round(file.size / 1024)} KB
                    ${file.driveUrl ? `<br><a href="${file.driveUrl}">View in Google Drive</a>` : ''}
                </div>
                `).join('')}
            </div>
            ` : ''}

            ${failedFiles.length > 0 ? `
            <div class="file-list">
                <h3>❌ Failed Backups</h3>
                ${failedFiles.map(file => `
                <div class="file-item">
                    <strong>${file.filename}</strong> (${file.format.toUpperCase()})
                    <br><span class="failed">Error: ${file.error}</span>
                </div>
                `).join('')}
            </div>
            ` : ''}

            <p><strong>Action Recommended:</strong> Some backups failed. Please review the errors and retry if necessary.</p>
        </div>
        
        <div class="footer">
            <p>Generated by Gym Backup System - ${formatDate(new Date(), 'PPP p')}</p>
        </div>
    </div>
</body>
</html>
    `;
  }

  /**
   * Generate partial success email text content
   */
  private static generatePartialEmailText(summary: BackupSummary, _options: NotificationOptions): string {
    const successfulFiles = summary.files.filter(f => f.uploadStatus === 'success');
    const failedFiles = summary.files.filter(f => f.uploadStatus === 'failed');
    
    let text = `⚠️ BACKUP PARTIAL SUCCESS

Gym Management Database Backup

📊 SUMMARY:
- Status: Partial Success
- Completed: ${formatDate(summary.endTime, 'PPP p')}
- Duration: ${Math.round(summary.duration / 1000)}s
- Successful: ${summary.successfulUploads}
- Failed: ${summary.failedUploads}
- Total Size: ${Math.round(summary.totalSize / 1024)} KB

`;

    if (successfulFiles.length > 0) {
      text += `✅ SUCCESSFUL BACKUPS:
${successfulFiles.map(file => 
        `- ${file.filename} (${file.format.toUpperCase()}) - ${Math.round(file.size / 1024)} KB`
      ).join('\n')}

`;
    }

    if (failedFiles.length > 0) {
      text += `❌ FAILED BACKUPS:
${failedFiles.map(file => 
        `- ${file.filename} (${file.format.toUpperCase()}) - Error: ${file.error}`
      ).join('\n')}

`;
    }

    text += `ACTION RECOMMENDED: Some backups failed. Please review the errors and retry if necessary.

Generated by Gym Backup System - ${formatDate(new Date(), 'PPP p')}`;

    return text;
  }

  /**
   * Test email configuration
   */
  public static async testEmailConfiguration(): Promise<void> {
    if (!this.transporter || !this.emailConfig) {
      throw new Error('Email service not initialized. Call initialize() first.');
    }

    console.log('🧪 Testing email configuration...');

    try {
      // Verify connection
      await this.transporter!.verify();
      console.log('✅ Email configuration test passed');

      // Send test email to configured user
      const testSubject = `📧 Gym Backup System - Email Test - ${formatDate(new Date(), 'yyyy-MM-dd HH:mm')}`;
      const testText = `This is a test email from the Gym Backup System.

Email service configuration is working correctly.

Service: ${this.emailConfig.service}
User: ${this.emailConfig.auth.user}
Sent: ${formatDate(new Date(), 'PPP p')}

This confirms that backup notifications will be delivered successfully.`;

      const testHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Email Test</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #2196F3; color: white; padding: 20px; text-align: center; border-radius: 5px;">
            <h1>📧 Email Test Successful</h1>
            <p>Gym Backup System</p>
        </div>
        
        <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px;">
            <p>This is a test email from the Gym Backup System.</p>
            
            <p><strong>Email service configuration is working correctly.</strong></p>
            
            <ul>
                <li><strong>Service:</strong> ${this.emailConfig.service}</li>
                <li><strong>User:</strong> ${this.emailConfig.auth.user}</li>
                <li><strong>Sent:</strong> ${formatDate(new Date(), 'PPP p')}</li>
            </ul>
            
            <p>This confirms that backup notifications will be delivered successfully.</p>
        </div>
        
        <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
            <p>Generated by Gym Backup System - ${formatDate(new Date(), 'PPP p')}</p>
        </div>
    </div>
</body>
</html>
      `;

      await this.sendEmail([this.emailConfig.auth.user], testSubject, testText, testHtml);
      console.log('✅ Test email sent successfully');

    } catch (error) {
      console.error('❌ Email configuration test failed:', error);
      throw new Error(`Email test failed: ${(error as Error)?.message || String(error)}`);
    }
  }
}

// Export convenience functions
export const initializeEmailService = EmailService.initializeFromEnv.bind(EmailService);
export const sendSuccessNotification = EmailService.sendSuccessNotification.bind(EmailService);
export const sendFailureNotification = EmailService.sendFailureNotification.bind(EmailService);
export const sendPartialNotification = EmailService.sendPartialNotification.bind(EmailService);
export const testEmailConfiguration = EmailService.testEmailConfiguration.bind(EmailService);