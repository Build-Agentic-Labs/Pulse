import { createClient } from "@supabase/supabase-js";

const [emailInput, password] = process.argv.slice(2);
const email = emailInput?.trim().toLowerCase();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://neaadefipcpxxcqszpud.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !password) {
  throw new Error("Usage: node scripts/upsert-auth-user.mjs <email> <password>");
}

if (!serviceKey) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function findUserByEmail(targetEmail) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) {
      throw error;
    }

    const found = data.users.find((user) => user.email?.toLowerCase() === targetEmail);
    if (found || data.users.length === 0) {
      return found;
    }
  }

  return undefined;
}

async function ensureWorkspaceMembership(userId) {
  const { data: memberships, error: memberReadError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId);

  if (memberReadError) {
    throw memberReadError;
  }

  if (memberships?.length) {
    return "membership_exists";
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (workspaceError) {
    throw workspaceError;
  }

  if (!workspace) {
    return "no_workspace_found";
  }

  const { error: insertError } = await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: userId,
    role: "editor",
  });

  if (insertError) {
    throw insertError;
  }

  return `added_editor_to_${workspace.id}`;
}

const existingUser = await findUserByEmail(email);
let action = "created";
let user;

if (existingUser) {
  const { data, error } = await supabase.auth.admin.updateUserById(existingUser.id, { password });
  if (error) {
    throw error;
  }
  user = data.user;
  action = "updated";
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    throw error;
  }
  user = data.user;
}

const { error: profileError } = await supabase.from("profiles").upsert({
  id: user.id,
  full_name: email,
  avatar_url: null,
});

if (profileError) {
  throw profileError;
}

const membershipAction = await ensureWorkspaceMembership(user.id);

console.log(JSON.stringify({ action, email: user.email, userId: user.id, membershipAction }));
