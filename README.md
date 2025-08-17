# Gym Management Database Backup System

Automated backup system for the Gym Management Database using GitHub Actions, Supabase, and Google Drive.

## Features

- **Automated Daily Backups** at 2 AM UTC
- **Multiple Formats**: SQL, JSON, and Excel exports
- **Google Drive Storage** with organized folder structure
- **Email Notifications** for success and failures
- **Retry Logic** for robust error handling
- **Zero Maintenance** once configured

## Quick Start

1. **Configure GitHub Secrets** (see `docs/GITHUB_SECRETS_SETUP.md`)
2. **Deploy to GitHub Actions** - workflow runs automatically
3. **Monitor via email notifications**

## Project Structure

```
backup_workflow/
├── src/                    # Source code
│   ├── config/            # Environment configuration
│   ├── database/          # Supabase client and exporters
│   ├── formats/           # File format generators (SQL, JSON, Excel)
│   ├── storage/           # Google Drive integration
│   ├── notifications/     # Email notification system
│   └── utils/            # Retry logic and error handling
├── tests/                 # Test files (development only)
├── docs/                  # Documentation (development only)
├── .github/workflows/     # GitHub Actions workflow
└── dist/                  # Compiled TypeScript (generated)
```

## Environment Variables

Required environment variables (set as GitHub Secrets):

- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `GOOGLE_DRIVE_CLIENT_EMAIL` - Service account email
- `GOOGLE_DRIVE_PRIVATE_KEY` - Service account private key
- `GOOGLE_DRIVE_PARENT_FOLDER_ID` - Google Drive folder ID
- `EMAIL_SERVICE` - Email service (gmail)
- `EMAIL_USER` - Sender email address
- `EMAIL_PASSWORD` - Email app password
- `EMAIL_TO` - Notification recipient email

## Backup Format

Backups are organized in Google Drive as:
```
Gym-Backups/
├── 2025/
│   ├── 01/
│   │   ├── 16/
│   │   │   ├── SQL/
│   │   │   │   └── gym_backup_2025-01-16_02-00-00.sql.gz
│   │   │   ├── JSON/
│   │   │   │   └── gym_backup_2025-01-16_02-00-00.json.gz
│   │   │   └── Excel/
│   │   │       └── gym_backup_2025-01-16_02-00-00.xlsx
```

## Manual Testing

Run tests locally (development only):
```bash
npm install
npm run build

# Test individual components
node tests/test-env.js
node tests/test-supabase.js
node tests/test-drive.js
node tests/test-email.js
```

## Production Deployment

The system runs automatically via GitHub Actions. No manual intervention required once configured.

## Error Handling

The system includes comprehensive error handling:
- **Retry Logic**: Automatic retries for temporary failures
- **Error Classification**: Different handling for auth vs. network errors
- **Graceful Degradation**: Continues operation when possible
- **Detailed Reporting**: Email notifications include error details

## Support

See `docs/GITHUB_SECRETS_SETUP.md` for detailed setup instructions.