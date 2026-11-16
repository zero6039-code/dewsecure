import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  try {
    const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!auth) return new Response("Unauthorized", { status: 401 });

    const { data: { user }, error: authError } = await supabase.auth.getUser(auth);
    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response("Invalid token", { status: 401 });
    }

    const code = crypto.randomUUID();

    const { error: insertError } = await supabase.from("handoff_codes").insert({
      code: code,
      user_id: user.id,
    });

    if (insertError) {
      console.error("DB Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Insert failed", details: insertError }), { 
        status: 500, 
        headers: { "Content-Type": "application/json" } 
      });
    }

    return new Response(JSON.stringify({ code }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Global error:", err);
    return new Response(JSON.stringify({ error: "Internal error", details: String(err) }), { 
      status: 500, 
      headers: { "Content-Type": "application/json" } 
    });
  }
});
