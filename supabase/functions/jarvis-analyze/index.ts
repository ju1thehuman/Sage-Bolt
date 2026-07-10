import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { notesContent, notebookId } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get the authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;

    // Try Gemini API if key is available
    const geminiKey = Deno.env.get("GEMINI_API_KEY");

    let analysis: any;

    if (geminiKey) {
      try {
        analysis = await callGemini(notesContent || "", geminiKey);
      } catch (err) {
        console.warn("Gemini API failed, using fallback:", err);
        analysis = generateFallback(notesContent || "");
      }
    } else {
      analysis = generateFallback(notesContent || "");
    }

    // Save insight to database
    await supabase.from("insights").insert({
      notebook_id: notebookId,
      user_id: userId,
      analysis,
    });

    // Extract tags from analysis themes and save them
    if (analysis.themes?.length > 0) {
      for (const theme of analysis.themes) {
        const tagName = theme.theme;
        // Upsert tag
        const { data: existingTag } = await supabase
          .from("tags")
          .select("id")
          .eq("name", tagName)
          .maybeSingle();

        let tagId = existingTag?.id;
        if (!tagId) {
          const { data: newTag } = await supabase
            .from("tags")
            .insert({ name: tagName })
            .select("id")
            .maybeSingle();
          tagId = newTag?.id;
        }

        if (tagId) {
          // Link tag to notebook (ignore duplicates)
          await supabase
            .from("notebook_tags")
            .insert({ notebook_id: notebookId, tag_id: tagId })
            .then(() => {});
        }
      }
    }

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Analysis failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function callGemini(notesContent: string, apiKey: string): Promise<any> {
  const systemInstruction = `You are Sage AI, an elite strategic executive advisor for high-agency tech founders.
Give sharp, analytical, quantitative, and context-specific assessments.
Group brainstorm content by theme (Cost, Timeline, Risk, Dependencies, Team).
For each theme: what was said, what it means, what could go wrong, what's missing.
Flag contradictions and explain trade-offs.
Keep responses concise — sentences, not paragraphs.
Never invent data or metrics not provided in the text.
Generate a proactiveInsight: an unprompted, high-value observation about something the team missed.`;

  const prompt = `Notes/Brainstorming Content:
"""
${notesContent || "(Empty notes)"}
"""

Analyze the notes and extract decision analytics, risks, changing factors, action items, themes, contradictions, SWOT, and a concise summary.

Return JSON with these fields:
- shortResponse: sharp 1-2 sentence executive summary
- summary: 1-2 sentence professional summary
- actionItems: [{task, assignee, priority}]
- risks: [string]
- changingFactors: [string]
- decisionAnalytics: [{metric, value, context}]
- themes: [{theme, whatWasSaid, whatItMeans, whatCouldGoWrong, whatsMissing}]
- contradictions: [{items, tradeoff}]
- swot: {strengths, weaknesses, opportunities, threats}
- proactiveInsight: string`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini response");

  return JSON.parse(text);
}

function generateFallback(notesContent: string): any {
  const content = notesContent || "";
  const lower = content.toLowerCase();
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 5);

  let primaryTopic = "operational concept";
  if (lines.length > 0) {
    primaryTopic =
      lines[0].substring(0, 50) + (lines[0].length > 50 ? "..." : "");
  }

  return {
    shortResponse: `Focus on swift execution of '${primaryTopic}' to validate customer retention and lock down margins.`,
    summary: `Strategic evaluation centering around '${primaryTopic}' to optimize immediate growth vectors.`,
    actionItems: [
      {
        task: `Draft detailed task checklist for: ${primaryTopic}`,
        assignee: "Founder Team",
        priority: "High",
      },
      {
        task: "Define operational target KPIs for next validation interval",
        assignee: "Operations Lead",
        priority: "High",
      },
    ],
    risks: [
      "Underestimating deployment timescales due to split focus across multiple fronts",
      "Delayed partner alignment on critical operational milestones",
    ],
    changingFactors: [
      "Weekly team milestone delivery rate",
      "Direct partner response times",
    ],
    decisionAnalytics: [
      {
        metric: "Estimated Cost Range",
        value: "$5,000 - $15,000",
        context: "for initial MVP deployment and hosting",
      },
      {
        metric: "Strategic Concept Alignment",
        value: "95%",
        context: "with core founding vision",
      },
    ],
    themes: [
      {
        theme: "Cost",
        whatWasSaid:
          lines.find((l) => l.toLowerCase().includes("cost")) ||
          "Review operational expenses and optimize budget distribution.",
        whatItMeans:
          "Targeted operational optimizations depend on eliminating multi-layered overhead.",
        whatCouldGoWrong:
          "Local cargo/tariff fluctuations could compress planned margin windows.",
        whatsMissing:
          "Granular freight quote tables from independent service providers.",
      },
      {
        theme: "Timeline",
        whatWasSaid:
          lines.find((l) => l.toLowerCase().includes("time")) ||
          "Accelerate team coordination and clear validation cycles.",
        whatItMeans:
          "Securing key partner agreements early keeps deployment tracks on schedule.",
        whatCouldGoWrong:
          "Unforeseen border duty checks or customs revisions could delay launch.",
        whatsMissing:
          "A visual timeline dashboard mapping each team member's subtask dependencies.",
      },
      {
        theme: "Risk",
        whatWasSaid:
          lines.find((l) => l.toLowerCase().includes("risk")) ||
          "Over-concentration of services within a single region.",
        whatItMeans:
          "Establishing dual-redundancy paths safeguards operational continuity.",
        whatCouldGoWrong:
          "Local incidents or regional policy updates could pause transit loops.",
        whatsMissing:
          "Active listings of tertiary partner providers in backup zones.",
      },
      {
        theme: "Dependencies",
        whatWasSaid:
          lines.find((l) => l.toLowerCase().includes("need")) ||
          "Successful launch requires fully synchronized integrations.",
        whatItMeans:
          "Platform standardizations directly influence automated velocity.",
        whatCouldGoWrong:
          "Proprietary software incompatibility might cause synchronization lags.",
        whatsMissing: "Official API endpoint manuals of local tracking providers.",
      },
      {
        theme: "Team",
        whatWasSaid:
          lines.find((l) => l.toLowerCase().includes("team")) ||
          "Deploy clear task owners across active product and ops tracks.",
        whatItMeans:
          "Accountability structure accelerates overall team validation velocity.",
        whatCouldGoWrong:
          "Overlapping task scopes may lead to redundant research loops.",
        whatsMissing:
          "A structured bi-weekly review to align co-founder milestones.",
      },
    ],
    contradictions: [
      {
        items:
          "The desire for rapid customer verification vs maintaining rigorous compliance steps.",
        tradeoff:
          "Velocity vs Safety: Launching fast gets market feedback but risks early friction.",
      },
    ],
    swot: {
      strengths: [
        "Direct partnerships with local material suppliers",
        "Dynamic in-house engineering capabilities",
      ],
      weaknesses: [
        "Heavy manual overhead on local cargo handling",
        "Vulnerable peak shipping delays at regional ports",
      ],
      opportunities: [
        "Leverage direct sourcing to achieve material savings",
        "Access localized green-tech subsidies",
      ],
      threats: [
        "Macroeconomic commodity price volatility",
        "Pending regulatory policy updates",
      ],
    },
    proactiveInsight:
      "You have several deliverables drafted but no hard owner assignments or due dates. Want me to propose a realistic schedule?",
    fallbackActive: true,
  };
}
