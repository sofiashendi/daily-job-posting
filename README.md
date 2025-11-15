# Daily Job Fetcher

This repository runs a daily GitHub Action that fetches new job postings from Google Jobs via SerpAPI, filters out entries published today, removes duplicates, and emails the results using Resend.

Created by **Sofia Shendi**  
https://sofiashendi.com

Everything runs on GitHub Actions, with no servers or deployment needed.

---

## Features

- Fetches fresh job postings once per day
- Uses SerpAPI to query Google Jobs
- Filters postings published today
- Removes duplicates by comparing job title and company
- Sends results to your email using Resend
- Fully automated through GitHub Actions

---

## Required Secrets

You must add these secrets in the repository settings under:

Settings → Secrets and Variables → Actions

### `SERPAPI_KEY`
Your free [SerpAPI](https://serpapi.com/) key

### `RESEND_API_KEY`
Your free [Resend](https://resend.com/) API key

### `SENDER_EMAIL_ADDRESS`
Verified sender email address (use a domain configured in Resend)

### `TO_EMAIL_ADDRESS`
Recipient email address that receives the daily job summary

### `ROLE_QUERY`
Comma-separated list of role queries to run each day  
Example:  
Engineering Manager jobs in Canada, Staff Engineer remote Canada

---

## How to Use

1. Fork this repository to your own GitHub account (use the **Fork** button in the top-right)
2. Update files if needed in your fork (the workflow and script are copied automatically)
3. Add the required secrets
4. The workflow runs daily at 12:00 UTC (07:00 EST time)
5. You can also trigger it manually via the Actions tab

---

## Customization

You can set `ROLE_QUERY` to anything, such as:

- Staff Engineer remote Canada
- Senior Engineering Manager Montréal
- Director of Engineering Canada

Include multiple values separated by commas to fetch several roles in one run. If the SerpAPI free tier limit is hit mid-run, the daily email will include a warning and the remaining roles are skipped to avoid exceeding the quota.

Before running the searches, the workflow checks your SerpAPI account (`total_searches_left`) so it knows how many roles can run that day. If there aren't enough credits for every role, it runs as many as possible and the email explains which roles were skipped because the quota was exhausted.

---

## Licence

MIT Licence  
Copyright © 2025  
Created by **Sofia Shendi**
