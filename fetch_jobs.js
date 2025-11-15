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

async function fetchJobs() {
    const serpKey = process.env.SERPAPI_KEY;
    const resendKey = process.env.RESEND_API_KEY;
    const senderEmailAddress = process.env.SENDER_EMAIL_ADDRESS;
    const toEmailAddress = process.env.TO_EMAIL_ADDRESS;
    const roleQuery = process.env.ROLE_QUERY || "Engineering Manager jobs in Canada";

    if (!serpKey || !resendKey || !senderEmailAddress || !toEmailAddress) {
        throw new Error("One or more environment variables are missing");
    }

    const resend = new Resend(resendKey);
    const encodedQuery = encodeURIComponent(roleQuery);

    const serpUrl = "https://serpapi.com/search.json?engine=google_jobs&q=" + encodedQuery + "&api_key=" + serpKey;

    let response;
    try {
        response = await fetch(serpUrl);
    } catch (requestError) {
        await notifySerpFailure(resend, senderEmailAddress, toEmailAddress, "SerpAPI request error: " + requestError.message);
        throw requestError;
    }

    if (!response.ok) {
        const body = await response.text();
        await notifySerpFailure(
            resend,
            senderEmailAddress,
            toEmailAddress,
            "SerpAPI responded with status " + response.status + ": " + response.statusText + "\n" + body
        );
        throw new Error("SerpAPI request failed with status " + response.status);
    }

    const json = await response.json();

    if (json.error) {
        const errorDetails = "SerpAPI error: " + json.error + (json.error_code ? " (" + json.error_code + ")" : "");
        await notifySerpFailure(resend, senderEmailAddress, toEmailAddress, errorDetails);
        throw new Error(errorDetails);
    }

    if (!json.jobs_results) {
        console.log("No job results returned by SerpAPI");
        return;
    }

    const todayOnly = json.jobs_results.filter(job =>
        isPostedToday(job.detected_extensions?.posted_at)
    );

    const deduped = removeDuplicates(todayOnly);

    if (deduped.length === 0) {
        console.log("No postings today");
        return;
    }

    const message = deduped.map(job => {
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

    await resend.emails.send({
        from: senderEmailAddress,
        to: toEmailAddress,
        subject: "New postings for " + roleQuery,
        text: message
    });

    console.log("Email sent");
}

fetchJobs().catch(err => {
    console.error(err);
    process.exit(1);
});
