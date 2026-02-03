# Daily Job Fetcher

Automated daily job posting aggregator that fetches from Google Jobs via SerpAPI and emails results using Resend. Runs entirely on GitHub Actions.

## Tech Stack

- Language: JavaScript (ES Modules)
- Runtime: Node.js 20
- Package Manager: npm
- APIs: SerpAPI (Google Jobs), Resend (email)
- CI/CD: GitHub Actions (scheduled daily at 12:00 UTC)

## Commands

```bash
# Install dependencies
npm install

# Run locally (requires env vars)
node fetch_jobs.js
```

## Project Structure

```
fetch_jobs.js              # Main script (single file)
.github/workflows/
  daily_email.yml          # Scheduled workflow
```

## Environment Variables

Required secrets (configured in GitHub repo settings):
- `SERPAPI_KEY` - SerpAPI access key
- `RESEND_API_KEY` - Resend API key
- `SENDER_EMAIL_ADDRESS` - Verified sender email
- `TO_EMAIL_ADDRESS` - Recipient email
- `ROLE_QUERY` - Comma-separated job search queries

## Key Behaviors

- Filters jobs to only those posted "today" (relative time detection)
- Deduplicates by title + company name
- Checks SerpAPI quota before running searches
- Skips remaining roles if quota exhausted (with notification)
- Sends failure notifications via email on API errors
