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
    const { notebookId, email, inviterName, notebookTitle } = await req.json();

    if (!notebookId || !email) {
      return new Response(
        JSON.stringify({ error: "notebookId and email are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify the caller is authenticated
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

    // Verify caller owns the notebook
    const { data: notebook } = await supabase
      .from("notebooks")
      .select("user_id, title")
      .eq("id", notebookId)
      .maybeSingle();

    if (!notebook || notebook.user_id !== userData.user.id) {
      return new Response(
        JSON.stringify({ error: "Only the notebook owner can invite collaborators" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Look up the user by email using admin API
    const { data: userList, error: lookupError } = await supabase.auth.admin.listUsers();

    if (lookupError) {
      return new Response(
        JSON.stringify({ error: "Failed to look up user" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const targetUser = userList.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (!targetUser) {
      return new Response(
        JSON.stringify({
          error: `No user found with email ${email}. Ask them to sign up first, then invite them again.`,
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already a collaborator
    const { data: existing } = await supabase
      .from("notebook_collaborators")
      .select("id")
      .eq("notebook_id", notebookId)
      .eq("user_id", targetUser.id)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ error: "User is already a collaborator on this notebook" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Add collaborator
    const { error: insertError } = await supabase
      .from("notebook_collaborators")
      .insert({
        notebook_id: notebookId,
        user_id: targetUser.id,
        role: "member",
      });

    if (insertError) {
      return new Response(
        JSON.stringify({ error: "Failed to add collaborator" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Invited ${email} to "${notebookTitle || notebook.title}"`,
        userId: targetUser.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Failed to invite collaborator" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
