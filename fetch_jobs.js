/**
 * Daily Job Fetcher
 * Created by Sofia Shendi
 * https://sofiashendi.com
 *
 * This script queries SerpAPI for Google Jobs listings based on a user-defined
 * role query, filters out jobs posted today, removes duplicates, and emails the
 * results using Resend.
 *
 * Environment variables:
 * SERPAPI_KEY
 * RESEND_API_KEY
 * SENDER_EMAIL_ADDRESS
 * TO_EMAIL_ADDRESS
 * ROLE_QUERY
 */

import { Resend } from "resend";

const QUOTA_EXCEEDED_CODE = "SERP_QUOTA_EXCEEDED";

/**
 * Determine whether a posting is from today.
 */
function isPostedToday(postedAt) {
    if (!postedAt) {
        return false;
    }

    const normalized = postedAt.toString().toLowerCase().trim();
    const sanitized = normalized.replace(/[.,]/g, " ");
    const relativePatterns = [
        /\bminute\b/,
        /\bminutes\b/,
        /\bmin\b/,
        /\bmins\b/,
        /\bhour\b/,
        /\bhours\b/,
        /\bhr\b/,
        /\bhrs\b/,
        /\btoday\b/
    ];

    if (normalized.includes("just posted") || normalized.includes("just now")) {
        return true;
    }

    if (relativePatterns.some(pattern => pattern.test(sanitized))) {
        return true;
    }

    const parsedDate = new Date(postedAt);
    if (!Number.isNaN(parsedDate.getTime())) {
        const now = new Date();
        return parsedDate.getFullYear() === now.getFullYear() &&
            parsedDate.getMonth() === now.getMonth() &&
            parsedDate.getDate() === now.getDate();
    }

    return false;
}

function normalizeText(value) {
    return (value || "").trim().toLowerCase();
}

/**
 * Remove duplicates by comparing job title plus company (normalized).
 */
function removeDuplicates(jobs) {
    const seen = new Set();
    const output = [];

    for (const job of jobs) {
        const key = normalizeText(job.title) + "|" + normalizeText(job.company_name);
        if (!seen.has(key)) {
            seen.add(key);
            output.push(job);
        }
    }

    return output;
}

function parseRoleQueries(rawRoles) {
    if (!rawRoles) {
        return [];
    }

    return rawRoles
        .split(",")
        .map(role => role.trim())
        .filter(role => role.length > 0);
}

function createQuotaExceededError(message) {
    const error = new Error(message);
    error.code = QUOTA_EXCEEDED_CODE;
    return error;
}

function isQuotaExceededError(error) {
    return Boolean(error && error.code === QUOTA_EXCEEDED_CODE);
}

function isQuotaErrorMessage(message) {
    if (!message) {
        return false;
    }

    const normalized = message.toLowerCase();
    return normalized.includes("quota") || normalized.includes("limit") || normalized.includes("exceeded");
}

function formatRoleSection(roleQuery, jobs) {
    if (jobs.length === 0) {
        return [
            "Role: " + roleQuery,
            "No new postings published today."
        ].join("\n");
    }

    const jobBlocks = jobs.map(job => {
        const applyUrl = job.apply_options?.[0]?.link || "Apply link unavailable";
        return [
            "Title: " + job.title,
            "Company: " + job.company_name,
            "Location: " + job.location,
            "Posted: " + job.detected_extensions?.posted_at,
            "Apply: " + applyUrl,
            ""
        ].join("\n");
    }).join("\n");

    return [
        "Role: " + roleQuery,
        jobBlocks.trim()
    ].join("\n");
}

function formatQuotaSection(roleQuery, isTriggeredRole, details) {
    if (isTriggeredRole) {
        return [
            "Role: " + roleQuery,
            details || "SerpAPI free tier limit reached while running this search.",
            "Remaining roles were skipped to avoid extra API calls."
        ].join("\n");
    }

    return [
        "Role: " + roleQuery,
        "Skipped because the SerpAPI free tier limit was reached earlier today."
    ].join("\n");
}

async function fetchRemainingSearches(serpKey, resend, senderEmailAddress, toEmailAddress) {
    const accountUrl = "https://serpapi.com/account?api_key=" + serpKey;

    let response;
    try {
        response = await fetch(accountUrl);
    } catch (requestError) {
        await notifySerpFailure(
            resend,
            senderEmailAddress,
            toEmailAddress,
            "SerpAPI account lookup error: " + requestError.message
        );
        throw requestError;
    }

    if (!response.ok) {
        const body = await response.text();
        await notifySerpFailure(
            resend,
            senderEmailAddress,
            toEmailAddress,
            "SerpAPI account endpoint responded with status " + response.status + ": " + response.statusText + "\n" + body
        );
        throw new Error("SerpAPI account lookup failed with status " + response.status);
    }

    const json = await response.json();
    const remaining = Number(
        json.total_searches_left ??
        json.plan_searches_left ??
        json.searches_left
    );

    if (!Number.isFinite(remaining)) {
        const message = "Unable to determine remaining SerpAPI searches from account response.";
        await notifySerpFailure(resend, senderEmailAddress, toEmailAddress, message);
        throw new Error(message);
    }

    return remaining;
}

async function notifySerpFailure(resend, fromAddress, toAddress, details) {
    if (!resend || !fromAddress || !toAddress) {
        return;
    }

    try {
        await resend.emails.send({
            from: fromAddress,
            to: toAddress,
            subject: "Daily job fetch failed",
            text: details
        });
    } catch (notifyError) {
        console.error("Failed to send failure notification:", notifyError);
    }
}

async function fetchRoleResults(roleQuery, serpKey, resend, senderEmailAddress, toEmailAddress) {
    const encodedQuery = encodeURIComponent(roleQuery);
    const serpUrl = "https://serpapi.com/search.json?engine=google_jobs&q=" + encodedQuery + "&api_key=" + serpKey;

    let response;
    try {
        response = await fetch(serpUrl);
    } catch (requestError) {
        await notifySerpFailure(
            resend,
            senderEmailAddress,
            toEmailAddress,
            "SerpAPI request error for \"" + roleQuery + "\": " + requestError.message
        );
        throw requestError;
    }

    if (response.status === 429) {
        throw createQuotaExceededError("SerpAPI free tier limit reached while fetching \"" + roleQuery + "\".");
    }

    if (!response.ok) {
        const body = await response.text();
        await notifySerpFailure(
            resend,
            senderEmailAddress,
            toEmailAddress,
            "SerpAPI responded with status " + response.status + " for \"" + roleQuery + "\": " + response.statusText + "\n" + body
        );
        throw new Error("SerpAPI request failed with status " + response.status);
    }

    const json = await response.json();

    if (json.error) {
        const errorDetails = "SerpAPI error for \"" + roleQuery + "\": " + json.error + (json.error_code ? " (" + json.error_code + ")" : "");
        if (isQuotaErrorMessage(json.error)) {
            throw createQuotaExceededError(errorDetails);
        }

        await notifySerpFailure(resend, senderEmailAddress, toEmailAddress, errorDetails);
        throw new Error(errorDetails);
    }

    if (!Array.isArray(json.jobs_results)) {
        return [];
    }

    const todayOnly = json.jobs_results.filter(job =>
        isPostedToday(job.detected_extensions?.posted_at)
    );

    return removeDuplicates(todayOnly);
}

async function fetchJobs() {
    const serpKey = process.env.SERPAPI_KEY;
    const resendKey = process.env.RESEND_API_KEY;
    const senderEmailAddress = process.env.SENDER_EMAIL_ADDRESS;
    const toEmailAddress = process.env.TO_EMAIL_ADDRESS;
    const roleEnvValue = process.env.ROLE_QUERY;

    if (!serpKey || !resendKey || !senderEmailAddress || !toEmailAddress) {
        throw new Error("One or more environment variables are missing");
    }

    if (!roleEnvValue) {
        throw new Error("ROLE_QUERY must be set with one or more comma-separated role queries");
    }

    const roleQueries = parseRoleQueries(roleEnvValue);

    if (roleQueries.length === 0) {
        throw new Error("ROLE_QUERY must include at least one non-empty role query");
    }

    const resend = new Resend(resendKey);
    const totalSearchesLeft = await fetchRemainingSearches(serpKey, resend, senderEmailAddress, toEmailAddress);
    let remainingSearches = totalSearchesLeft;

    const sections = [];
    let hasAnyPosting = false;
    let quotaTriggered = false;
    let quotaMessageSent = false;

    for (let index = 0; index < roleQueries.length; index += 1) {
        const role = roleQueries[index];

        if (remainingSearches <= 0) {
            quotaTriggered = true;
            const isFirstQuotaNotice = !quotaMessageSent;
            const details = isFirstQuotaNotice
                ? (totalSearchesLeft === 0
                    ? "SerpAPI search credits are exhausted for today."
                    : "SerpAPI only had " + totalSearchesLeft + " search" + (totalSearchesLeft === 1 ? "" : "es") + " available and they were used by earlier roles in this run.")
                : undefined;
            sections.push(formatQuotaSection(role, isFirstQuotaNotice, details));
            quotaMessageSent = true;
            continue;
        }

        try {
            const jobs = await fetchRoleResults(role, serpKey, resend, senderEmailAddress, toEmailAddress);
            if (jobs.length > 0) {
                hasAnyPosting = true;
            }
            sections.push(formatRoleSection(role, jobs));
            remainingSearches -= 1;
        } catch (error) {
            if (isQuotaExceededError(error)) {
                quotaTriggered = true;
                sections.push(formatQuotaSection(role, true, error.message));
                quotaMessageSent = true;
                remainingSearches = 0;
                continue;
            }

            throw error;
        }
    }

    if (!quotaTriggered && !hasAnyPosting) {
        console.log("No postings today");
        return;
    }

    const emailBody = sections.join("\n\n");

    await resend.emails.send({
        from: senderEmailAddress,
        to: toEmailAddress,
        subject: "Latest job postings",
        text: emailBody
    });

    console.log("Email sent");
}

fetchJobs().catch(err => {
    console.error(err);
    process.exit(1);
});
