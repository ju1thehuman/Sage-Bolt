import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  Plus, Users, MessageSquare, LogOut, Check, X,
  Clock, Mail, Compass, Send, Sparkles,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { Notebook, Tag } from "@/lib/types";
import { toast } from "sonner";

interface NotebookWithMeta extends Notebook {
  tags: Tag[];
  collaboratorCount: number;
  blockCount: number;
}

export default function DashboardPage() {
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const [notebooks, setNotebooks] = useState<NotebookWithMeta[]>([]);
  const [allTags, setAllTags] = useState<{ tag: Tag; count: number }[]>([]);
  const [recentBlocks, setRecentBlocks] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteNotebookId, setInviteNotebookId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { data: nbs } = await supabase
      .from("notebooks")
      .select("*")
      .order("last_updated", { ascending: false });

    if (!nbs || nbs.length === 0) {
      setNotebooks([]);
      setRecentBlocks([]);
      setLoading(false);
      return;
    }

    const nbList = nbs as Notebook[];
    const result: NotebookWithMeta[] = [];

    for (const nb of nbList) {
      const [{ data: tags }, { count: collabCount }, { count: blockCount }] =
        await Promise.all([
          supabase
            .from("notebook_tags")
            .select("tag_id, tags(id, name)")
            .eq("notebook_id", nb.id),
          supabase
            .from("notebook_collaborators")
            .select("*", { count: "exact", head: true })
            .eq("notebook_id", nb.id),
          supabase
            .from("note_blocks")
            .select("*", { count: "exact", head: true })
            .eq("notebook_id", nb.id),
        ]);

      const tagList: Tag[] =
        (tags?.map((t: any) => t.tags).filter(Boolean) as Tag[]) || [];

      result.push({
        ...nb,
        tags: tagList,
        collaboratorCount: collabCount || 0,
        blockCount: blockCount || 0,
      });
    }

    setNotebooks(result);

    // Aggregate tag counts
    const tagMap = new Map<string, { tag: Tag; count: number }>();
    for (const nb of result) {
      for (const tag of nb.tags) {
        const existing = tagMap.get(tag.id);
        if (existing) existing.count++;
        else tagMap.set(tag.id, { tag, count: 1 });
      }
    }
    setAllTags(Array.from(tagMap.values()).sort((a, b) => b.count - a.count));

    // Fetch recent text blocks across all notebooks
    const notebookIds = nbList.map(nb => nb.id);
    if (notebookIds.length > 0) {
      const { data: recentBlks } = await supabase
        .from("note_blocks")
        .select("id, content, type, notebook_id, updated_at")
        .in("notebook_id", notebookIds)
        .eq("type", "text")
        .order("updated_at", { ascending: false })
        .limit(5);
      
      if (recentBlks) {
        const enriched = (recentBlks as any[])
          .filter(b => b.content && b.content.length > 20)
          .slice(0, 4)
          .map(b => {
            const nb = nbList.find(n => n.id === b.notebook_id);
            return { ...b, notebookTitle: nb?.title || "Unknown" };
          });
        setRecentBlocks(enriched);
      }
    }

    setLoading(false);
  }, [user]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const ownedWorkspaces = notebooks.filter(
    (nb) => nb.user_id === user?.id
  );
  const sharedWorkspaces = notebooks.filter(
    (nb) => nb.user_id !== user?.id
  );

  async function createNotebook() {
    if (!newTitle.trim()) return;
    setIsCreating(true);
    const { data, error } = await supabase
      .from("notebooks")
      .insert({ title: newTitle.trim() })
      .select()
      .maybeSingle();
    setIsCreating(false);
    if (error) {
      toast.error("Failed to create workspace");
      return;
    }
    setNewTitle("");
    setShowCreateModal(false);
    toast.success("Workspace created");
    navigate(`/notebook/${(data as Notebook).id}`);
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteNotebookId || !inviteEmail.trim()) return;
    setIsInviting(true);
    setInviteError(null);
    setInviteSuccess(false);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-collaborator`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionData.session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            notebookId: inviteNotebookId,
            email: inviteEmail.trim().toLowerCase(),
            inviterName: profile?.display_name || user?.email,
            notebookTitle: notebooks.find((nb) => nb.id === inviteNotebookId)?.title,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error || "Could not dispatch invitation.");
      } else {
        setInviteSuccess(true);
        setInviteEmail("");
        loadDashboard();
        setTimeout(() => {
          setInviteSuccess(false);
          setShowInviteModal(false);
        }, 2000);
      }
    } catch {
      setInviteError("Failed to send invitation.");
    } finally {
      setIsInviting(false);
    }
  }

  const totalCollaborators = notebooks.reduce((sum, nb) => sum + nb.collaboratorCount, 0);
  const totalBlocks = notebooks.reduce((sum, nb) => sum + nb.blockCount, 0);

  return (
    <div className="min-h-screen bg-[#F4F6F9] text-slate-800 flex flex-col font-sans select-none">
      {/* Header */}
      <header className="bg-white border-b border-slate-200/80 px-6 py-4 flex items-center justify-between sticky top-0 z-30 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-slate-900 flex items-center justify-center font-black font-sans text-white text-base shadow-premium">
            S
          </div>
          <div>
            <h1 className="font-sans font-bold text-sm tracking-tight text-slate-900 leading-none">
              Sage Workspace
            </h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono mt-1">
              Leadership Hub
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
            <div className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-2xs font-bold">
              {profile?.avatar_initials || "?"}
            </div>
            <div className="text-left">
              <p className="text-3xs font-bold font-mono text-slate-400 uppercase tracking-wider leading-none">Logged In</p>
              <p className="text-2xs font-bold text-slate-800 leading-tight mt-0.5">{profile?.display_name || user?.email}</p>
            </div>
          </div>

          <button
            onClick={() => { signOut(); navigate("/auth"); }}
            className="p-2.5 bg-slate-50 border border-slate-200 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 rounded-xl transition duration-200 cursor-pointer text-slate-500"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6 md:p-8">
        {/* Welcome */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 font-sans tracking-tight">Executive Dashboard</h2>
            <p className="text-xs text-slate-500 mt-1">
              Select or create brainstorm workspaces, manage collaborative invitations, and view recently drafted notes.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (notebooks.length > 0) {
                  setInviteNotebookId(notebooks[0].id);
                  setShowInviteModal(true);
                }
              }}
              disabled={notebooks.length === 0}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl transition disabled:opacity-50 cursor-pointer"
            >
              <Mail className="w-4 h-4 text-slate-500" />
              Invite Collaborator
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-premium transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New Workspace
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Workspaces", value: notebooks.length, icon: MessageSquare },
            { label: "Collaborators", value: totalCollaborators, icon: Users },
            { label: "Note Blocks", value: totalBlocks, icon: Clock },
            { label: "Topics Tagged", value: allTags.length, icon: Sparkles },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-2xs">
              <div className="flex items-center gap-2 text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider mb-2">
                <Icon className="w-3.5 h-3.5" /> {label}
              </div>
              <p className="text-2xl font-bold text-slate-900 font-sans">{value}</p>
            </div>
          ))}
        </div>

        {/* Topic Tags */}
        {allTags.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-2xs">
            <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Topics Discussed
            </h3>
            <div className="flex flex-wrap gap-2">
              {allTags.map(({ tag, count }) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-full"
                >
                  {tag.name}
                  <span className="bg-slate-900 text-white text-3xs font-mono px-1.5 rounded-full">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Col 1&2: Workspaces */}
          <div className="lg:col-span-2 space-y-6">
            {/* Owned */}
            <div className="space-y-3">
              <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">
                My Workspaces ({ownedWorkspaces.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ownedWorkspaces.map((nb) => (
                  <div
                    key={nb.id}
                    onClick={() => navigate(`/notebook/${nb.id}`)}
                    className="bg-white border border-slate-200/80 hover:border-slate-350 hover:shadow-md rounded-2xl p-5 cursor-pointer transition-all duration-200 group flex flex-col justify-between h-40 relative"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] bg-slate-100 text-slate-600 font-mono font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                          Owner
                        </span>
                        <span className="text-3xs text-slate-400 font-mono flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {new Date(nb.last_updated).toLocaleDateString()}
                        </span>
                      </div>
                      <h4 className="font-sans font-bold text-xs text-slate-800 leading-snug group-hover:text-blue-600 transition truncate-2-lines pr-2">
                        {nb.title}
                      </h4>
                      {nb.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {nb.tags.slice(0, 3).map((tag) => (
                            <span key={tag.id} className="text-4xs font-mono bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="border-t border-slate-100 pt-3 flex items-center justify-between mt-4 text-[10px] font-mono text-slate-400">
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" /> {nb.collaboratorCount} collaborators
                      </span>
                      <span className="text-slate-300 group-hover:text-slate-600 transition">Open Workspace →</span>
                    </div>
                  </div>
                ))}
                {ownedWorkspaces.length === 0 && (
                  <div className="col-span-2 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center space-y-2">
                    <Compass className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-xs font-bold text-slate-600">No workspaces created yet</p>
                    <p className="text-3xs text-slate-400">Create a new brainstorm workspace above to begin.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Shared */}
            <div className="space-y-3">
              <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">
                Shared With Me ({sharedWorkspaces.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sharedWorkspaces.map((nb) => (
                  <div
                    key={nb.id}
                    onClick={() => navigate(`/notebook/${nb.id}`)}
                    className="bg-white border border-slate-200/80 hover:border-slate-350 hover:shadow-md rounded-2xl p-5 cursor-pointer transition-all duration-200 group flex flex-col justify-between h-40"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] bg-blue-50 text-blue-600 font-mono font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                          Collaborator
                        </span>
                        <span className="text-3xs text-slate-400 font-mono flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {new Date(nb.last_updated).toLocaleDateString()}
                        </span>
                      </div>
                      <h4 className="font-sans font-bold text-xs text-slate-800 leading-snug group-hover:text-blue-600 transition truncate-2-lines pr-2">
                        {nb.title}
                      </h4>
                    </div>
                    <div className="border-t border-slate-100 pt-3 flex items-center justify-between mt-4 text-[10px] font-mono text-slate-400">
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" /> {nb.collaboratorCount} collaborators
                      </span>
                      <span className="text-slate-300 group-hover:text-slate-600 transition">Open Workspace →</span>
                    </div>
                  </div>
                ))}
                {sharedWorkspaces.length === 0 && (
                  <div className="col-span-2 bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-400 text-2xs">
                    No shared workspaces active. Ask collaborators to invite you via your email!
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Col 3: Side Panel */}
          <div className="space-y-6">
            {/* Recent Notes */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-3xs">
              <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Recent Brainboard Notes
              </h3>
              <div className="space-y-3.5">
                {recentBlocks.map((block: any, idx) => (
                  <div
                    key={block.id || idx}
                    onClick={() => navigate(`/notebook/${block.notebookId}`)}
                    className="border-l-2 border-slate-300 hover:border-blue-500 pl-3.5 py-1 text-left cursor-pointer transition group"
                  >
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider font-mono truncate">
                      {block.notebookTitle}
                    </p>
                    <p className="text-2xs text-slate-600 font-sans mt-1 line-clamp-2 leading-relaxed group-hover:text-slate-800 transition">
                      {block.content}
                    </p>
                  </div>
                ))}
                {recentBlocks.length === 0 && (
                  <p className="text-3xs text-slate-400 font-mono py-4 text-center">
                    No notes written yet. Open a brainstorm workspace to start typing!
                  </p>
                )}
              </div>
            </div>

            {/* Profile Card */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-5 space-y-3.5 shadow-lg border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold font-sans text-2xs">
                  {profile?.avatar_initials || "?"}
                </div>
                <div>
                  <h4 className="font-bold text-xs text-slate-100">{profile?.display_name || "User"}</h4>
                  <p className="text-3xs text-slate-400 font-mono truncate max-w-[180px]">{user?.email}</p>
                </div>
              </div>
              <div className="border-t border-slate-700 pt-3 text-[10px] text-slate-400 font-mono space-y-1">
                <p>🔑 Active Session Status: Secure</p>
                <p>⚡ Workspace Authorization: Full Access</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-3xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4 border border-slate-100 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-sans font-bold text-sm text-slate-800">Create Brainstorm Board</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); createNotebook(); }}
              className="space-y-3"
            >
              <div>
                <label className="block text-4xs font-bold font-mono text-slate-500 uppercase tracking-wider mb-1">
                  Brainstorm Board Title
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. 🚀 Q4 Global Scaling Operations"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>
              <button
                type="submit"
                disabled={isCreating}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 rounded-xl transition shadow-premium flex items-center justify-center gap-1 cursor-pointer"
              >
                {isCreating ? "Initializing..." : <>Initialize Workspace →</>}
              </button>
            </form>
          </motion.div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-3xs flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 border border-slate-100 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-sans font-bold text-sm text-slate-800">Invite Collaborator</h3>
              <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-slate-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {inviteSuccess ? (
              <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-100 text-center space-y-2">
                <Check className="w-6 h-6 text-emerald-600 mx-auto" />
                <h4 className="font-bold text-xs">Invitation Sent Successfully</h4>
                <p className="text-3xs text-slate-500">Collaborator has been added to this workspace.</p>
              </div>
            ) : (
              <form onSubmit={sendInvite} className="space-y-4">
                {inviteError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-800 text-3xs font-mono">
                    ⚠️ Error: {inviteError}
                  </div>
                )}
                <div>
                  <label className="block text-4xs font-bold font-mono text-slate-500 uppercase tracking-wider mb-1">
                    Select Brainstorm Board
                  </label>
                  <select
                    value={inviteNotebookId}
                    onChange={(e) => setInviteNotebookId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 font-semibold"
                  >
                    {notebooks.map((nb) => (
                      <option key={nb.id} value={nb.id}>{nb.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-4xs font-bold font-mono text-slate-500 uppercase tracking-wider mb-1">
                    Collaborator Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="partner@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isInviting}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 rounded-xl transition shadow-premium flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isInviting ? "Sending Invitation..." : "Send Secure Invitation"}
                </button>
              </form>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
