import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface EnvironmentConfig {
  // Supabase Configuration
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  
  // Google Drive Configuration
  googleDrive: {
    clientEmail: string;
    privateKey: string;
    parentFolderId: string;
  };
  
  // Email Configuration
  email: {
    service: string;
    user: string;
    password: string;
    to: string;
  };
  
  // System Configuration
  nodeEnv: string;
  
  // Backup Configuration
  backup: {
    retentionDays: number;
    compression: boolean;
    timezone: string;
  };
}

function validateEnvVar(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function getEnvironmentConfig(): EnvironmentConfig {
  return {
    supabase: {
      url: validateEnvVar('SUPABASE_URL', process.env.SUPABASE_URL),
      serviceRoleKey: validateEnvVar('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
    googleDrive: {
      clientEmail: validateEnvVar('GOOGLE_DRIVE_CLIENT_EMAIL', process.env.GOOGLE_DRIVE_CLIENT_EMAIL),
      privateKey: validateEnvVar('GOOGLE_DRIVE_PRIVATE_KEY', process.env.GOOGLE_DRIVE_PRIVATE_KEY),
      parentFolderId: validateEnvVar('GOOGLE_DRIVE_PARENT_FOLDER_ID', process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID),
    },
    email: {
      service: validateEnvVar('EMAIL_SERVICE', process.env.EMAIL_SERVICE),
      user: validateEnvVar('EMAIL_USER', process.env.EMAIL_USER),
      password: validateEnvVar('EMAIL_PASSWORD', process.env.EMAIL_PASSWORD),
      to: validateEnvVar('EMAIL_TO', process.env.EMAIL_TO),
    },
    nodeEnv: process.env.NODE_ENV || 'development',
    backup: {
      retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '365'),
      compression: process.env.BACKUP_COMPRESSION === 'true',
      timezone: process.env.BACKUP_TIMEZONE || 'UTC',
    },
  };
}

export const config = getEnvironmentConfig();