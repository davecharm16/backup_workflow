# GitHub Secrets Setup Guide

This document provides instructions for configuring the required GitHub Secrets for the automated backup system.

## Required Secrets

### Supabase Credentials
Navigate to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

1. **SUPABASE_URL**
   - Name: `SUPABASE_URL`
   - Value: Your Supabase project URL (e.g., `https://your-project.supabase.co`)
   - Source: Found in your Supabase project settings

2. **SUPABASE_SERVICE_ROLE_KEY**
   - Name: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: Your Supabase service role key (starts with `eyJ...`)
   - Source: Supabase project settings → API → service_role key
   - ⚠️ **Warning**: This key has full database access - keep it secure!

### Google Drive API Credentials
3. **GOOGLE_DRIVE_CLIENT_EMAIL**
   - Name: `GOOGLE_DRIVE_CLIENT_EMAIL`
   - Value: Service account email from Google Cloud Console
   - Format: `backup-service@your-project.iam.gserviceaccount.com`

4. **GOOGLE_DRIVE_PRIVATE_KEY**
   - Name: `GOOGLE_DRIVE_PRIVATE_KEY`
   - Value: Private key from service account JSON (including `-----BEGIN PRIVATE KEY-----` headers)
   - ⚠️ **Important**: Include the entire key with line breaks as-is

5. **GOOGLE_DRIVE_PARENT_FOLDER_ID**
   - Name: `GOOGLE_DRIVE_PARENT_FOLDER_ID`
   - Value: Google Drive folder ID where backups will be stored
   - How to get: Create a folder in Google Drive, share it with the service account, copy the folder ID from the URL

### Email Notification Settings
6. **EMAIL_SERVICE**
   - Name: `EMAIL_SERVICE`
   - Value: `gmail` or `smtp`
   - Recommended: `gmail` for simplicity

7. **EMAIL_USER**
   - Name: `EMAIL_USER`
   - Value: Your email address for sending notifications
   - Example: `your-email@gmail.com`

8. **EMAIL_PASSWORD**
   - Name: `EMAIL_PASSWORD`
   - Value: App-specific password (not your regular password)
   - For Gmail: Generate at https://myaccount.google.com/apppasswords

9. **EMAIL_TO**
   - Name: `EMAIL_TO`
   - Value: Email address to receive backup notifications
   - Can be the same as EMAIL_USER or different

## Setup Instructions

### Step 1: Supabase Setup
1. Go to your Supabase project dashboard
2. Navigate to Settings → API
3. Copy the Project URL and Service Role Key
4. Add them as GitHub Secrets

### Step 2: Google Drive Setup
1. Go to Google Cloud Console
2. Create a new project or select existing
3. Enable Google Drive API
4. Create a Service Account
5. Download the service account JSON file
6. Extract client_email and private_key
7. Create a Google Drive folder for backups
8. Share the folder with the service account email
9. Add credentials as GitHub Secrets

### Step 3: Email Setup
1. Use your Gmail account or configure SMTP
2. For Gmail: Enable 2FA and create an App Password
3. Add email credentials as GitHub Secrets

### Step 4: Verification
Once all secrets are configured, the GitHub Actions workflow will have access to:
- Supabase database for data export
- Google Drive for backup storage
- Email service for notifications

## Security Notes
- Never commit these credentials to your repository
- Service account should have minimal required permissions
- Regularly rotate secrets for security
- Monitor GitHub Actions logs for any credential exposure