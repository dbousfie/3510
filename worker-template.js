// worker.js — Cloudflare Workers template for syllabus bots
//
// This file is identical for every bot. Only the env vars differ between bots.
// To migrate from Deno: paste this into a new Cloudflare Worker and set the
// env vars below in the dashboard (Settings → Variables and Secrets).
//
// Required environment variables:
//
//   OPENAI_API_KEY        (Secret)  required
//   QUALTRICS_API_TOKEN   (Secret)  optional, needed for logging
//   QUALTRICS_SURVEY_ID   (Text)    optional, needed for logging
//   QUALTRICS_DATACENTER  (Text)    optional, e.g. "uwo.eu"
//   SYLLABUS_LINK         (Text)    course web page shown in every response
//   OPENAI_MODEL          (Text)    optional, defaults to gpt-4o-mini
//   SYLLABUS_URL          (Text)    raw GitHub URL of this bot's syllabus.md
//                                   e.g. https://raw.githubusercontent.com/USER/REPO/main/syllabus.md

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(req, env) {
    // Read env vars (was: Deno.env.get(...) at top of file in main.ts)
    const OPENAI_API_KEY = env.OPENAI_API_KEY;
    const QUALTRICS_API_TOKEN = env.QUALTRICS_API_TOKEN;
    const QUALTRICS_SURVEY_ID = env.QUALTRICS_SURVEY_ID;
    const QUALTRICS_DATACENTER = env.QUALTRICS_DATACENTER;
    const SYLLABUS_LINK = env.SYLLABUS_LINK || "";
    const OPENAI_MODEL = env.OPENAI_MODEL || "gpt-4o-mini";
    const SYLLABUS_URL = env.SYLLABUS_URL;

    // 1. Handle CORS Preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 2. Enforce POST Method
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    // 3. Parse Body securely
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
    }

    // 4. Check for required env vars
    if (!OPENAI_API_KEY) {
      return new Response("Missing OpenAI API key. Check Cloudflare Variables and Secrets.", { status: 500, headers: corsHeaders });
    }
    if (!SYLLABUS_URL) {
      return new Response("Missing SYLLABUS_URL. Check Cloudflare Variables and Secrets.", { status: 500, headers: corsHeaders });
    }

    // 5. Load Syllabus from GitHub (was: Deno.readTextFile("syllabus.md"))
    //    cache: "no-store" forces a fresh fetch every time, so edits to
    //    syllabus.md on GitHub appear immediately without redeploying.
    const syllabus = await fetch(SYLLABUS_URL, { cache: "no-store" })
      .then(r => r.text())
      .catch(() => "Error loading syllabus.");

    const messages = [
      {
        role: "system",
        content: "You are an accurate assistant. Always include a source URL if possible."
      },
      {
        role: "system",
        content: `Here is important context from syllabus.md:\n${syllabus}`,
      },
      {
        role: "user",
        content: body.query,
      },
    ];

    // 6. Call OpenAI
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        max_tokens: 1500,
      }),
    });

    const openaiJson = await openaiResponse.json();
    const baseResponse = openaiJson?.choices?.[0]?.message?.content || "No response from OpenAI";
    const result = `${baseResponse}\n\nThere may be errors in my responses; always refer to the course web page: ${SYLLABUS_LINK}`;

    // 7. Qualtrics Logging (Wrapped in try/catch to prevent crashing)
    let qualtricsStatus = "Qualtrics not called (Check Env Vars)";

    if (QUALTRICS_API_TOKEN && QUALTRICS_SURVEY_ID && QUALTRICS_DATACENTER) {
      try {
        const qualtricsPayload = {
          values: {
            responseText: result,
            queryText: body.query,
          },
        };

        const qt = await fetch(`https://${QUALTRICS_DATACENTER}.qualtrics.com/API/v3/surveys/${QUALTRICS_SURVEY_ID}/responses`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-TOKEN": QUALTRICS_API_TOKEN,
          },
          body: JSON.stringify(qualtricsPayload),
        });

        qualtricsStatus = `Qualtrics status: ${qt.status}`;
      } catch (e) {
        console.error(e);
        qualtricsStatus = "Qualtrics connection failed";
      }
    }

    // 8. Return Final Response
    return new Response(`${result}\n\n[System Log: ${qualtricsStatus}]`, {
      headers: {
        "Content-Type": "text/plain",
        ...corsHeaders,
      },
    });
  }
};
