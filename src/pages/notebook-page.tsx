import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { speakText, stopSpeaking } from "@/utils/speechUtils";
import type {
  Notebook, NoteBlock, BlockType, TableData, PollData,
  Collaborator, Profile, JarvisInsight,
} from "@/lib/types";
import {
  Plus, Table, Check, Trash2,
  Sparkles, Volume2, Square, ArrowLeft, Users, Mail,
  Send, Loader2, MessageSquare, Activity,
} from "lucide-react";
import { toast } from "sonner";
import JarvisPanel from "@/components/jarvis-panel";
import ShareModal from "@/components/share-modal";

const FONT_SIZES: Record<string, string> = {
  sm: "text-sm", base: "text-base", lg: "text-lg", xl: "text-xl",
};

const HIGHLIGHT_COLORS = [
  { class: "bg-amber-200", name: "amber" },
  { class: "bg-emerald-200", name: "emerald" },
  { class: "bg-sky-200", name: "sky" },
];

const COLLAB_COLORS = ["bg-indigo-600", "bg-emerald-600", "bg-blue-600", "bg-amber-600", "bg-slate-600"];

function getColorForName(name: string) {
  const hash = name.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}

export default function NotebookPage() {
  const { notebookId } = useParams<{ notebookId: string }>();
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [blocks, setBlocks] = useState<NoteBlock[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [jarvisOpen, setJarvisOpen] = useState(false);
  const [insight, setInsight] = useState<JarvisInsight | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Sidebar state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Co-Founder");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const loadNotebook = useCallback(async () => {
    if (!notebookId) return;
    setLoading(true);

    const { data: nb } = await supabase
      .from("notebooks").select("*").eq("id", notebookId).maybeSingle();
    if (!nb) { toast.error("Notebook not found"); navigate("/"); return; }
    setNotebook(nb as Notebook);

    const { data: blks } = await supabase
      .from("note_blocks").select("*").eq("notebook_id", notebookId)
      .order("position", { ascending: true });
    setBlocks((blks as NoteBlock[]) || []);

    const { data: collabs } = await supabase
      .from("notebook_collaborators").select("*").eq("notebook_id", notebookId);
    setCollaborators((collabs as Collaborator[]) || []);

    const { data: latestInsight } = await supabase
      .from("insights").select("*").eq("notebook_id", notebookId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (latestInsight) setInsight((latestInsight as any).analysis as JarvisInsight);

    setLoading(false);
  }, [notebookId, navigate]);

  // Load sidebar notebooks
  useEffect(() => {
    async function loadNotebooks() {
      if (!user) return;
      const { data } = await supabase
        .from("notebooks").select("*").order("last_updated", { ascending: false });
      setNotebooks((data as Notebook[]) || []);
    }
    loadNotebooks();
  }, [user]);

  useEffect(() => { loadNotebook(); }, [loadNotebook]);

  // Load collaborator profiles
  useEffect(() => {
    async function loadProfiles() {
      if (!notebookId || collaborators.length === 0) return;
      const userIds = collaborators.map((c) => c.user_id);
      const { data: profiles } = await supabase
        .from("profiles").select("*").in("id", userIds);
      const map = new Map<string, Profile>(
        (profiles as Profile[])?.map((p) => [p.id, p]) || []
      );
      setCollaborators((prev) =>
        prev.map((c) => ({ ...c, profile: map.get(c.user_id) }))
      );
    }
    loadProfiles();
  }, [notebookId, collaborators.length]);

  async function updateNotebookTitle(title: string) {
    if (!notebookId || !notebook) return;
    setNotebook({ ...notebook, title });
    await supabase.from("notebooks").update({ title }).eq("id", notebookId);
  }

  async function addBlock(type: BlockType) {
    if (!notebookId) return;
    const position = blocks.length;
    const newBlock: any = {
      notebook_id: notebookId, position, type, content: "",
    };
    if (type === "table") {
      newBlock.table_data = { headers: ["Column 1", "Column 2"], rows: [["", ""]] };
    } else if (type === "poll") {
      newBlock.poll_data = {
        question: "",
        options: [
          { id: crypto.randomUUID(), text: "Option 1", votes: 0 },
          { id: crypto.randomUUID(), text: "Option 2", votes: 0 },
        ],
        voted_user_ids: [],
      };
    }
    const { data, error } = await supabase
      .from("note_blocks").insert(newBlock).select().maybeSingle();
    if (error) { toast.error("Failed to add block"); return; }
    setBlocks([...blocks, data as NoteBlock]);
  }

  async function updateBlock(id: string, updates: Partial<NoteBlock>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...updates } : b)));
    const { table_data, poll_data, content, ...rest } = updates;
    const dbUpdates: any = { ...rest, updated_at: new Date().toISOString() };
    if (content !== undefined) dbUpdates.content = content;
    if (table_data !== undefined) dbUpdates.table_data = table_data;
    if (poll_data !== undefined) dbUpdates.poll_data = poll_data;
    await supabase.from("note_blocks").update(dbUpdates).eq("id", id);
  }

  async function deleteBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    await supabase.from("note_blocks").delete().eq("id", id);
  }

  async function inviteCollaborator() {
    if (!notebookId || !inviteEmail.trim()) return;
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
            notebookId, email: inviteEmail.trim().toLowerCase(),
            inviterName: profile?.display_name || user?.email,
            notebookTitle: notebook?.title,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error || "Could not dispatch invitation.");
      } else {
        setInviteSuccess(true);
        setInviteEmail("");
        setTimeout(() => { setInviteSuccess(false); setShowInviteForm(false); }, 2000);
        loadNotebook();
      }
    } catch {
      setInviteError("Failed to send invitation.");
    } finally {
      setIsInviting(false);
    }
  }

  async function voteOnPoll(blockId: string, optionId: string) {
    const block = blocks.find((b) => b.id === blockId);
    if (!block?.poll_data) return;
    if (block.poll_data.voted_user_ids.includes(user!.id)) {
      toast.info("You've already voted");
      return;
    }
    const updatedPoll: PollData = {
      ...block.poll_data,
      options: block.poll_data.options.map((opt) =>
        opt.id === optionId ? { ...opt, votes: opt.votes + 1 } : opt
      ),
      voted_user_ids: [...block.poll_data.voted_user_ids, user!.id],
    };
    await updateBlock(blockId, { poll_data: updatedPoll });
  }

  function handleSpeak(text: string) {
    if (isSpeaking) { stopSpeaking(); setIsSpeaking(false); return; }
    speakText(text, undefined, () => setIsSpeaking(false));
    setIsSpeaking(true);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F6F9] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  const activeNotebookId = notebookId;

  return (
    <div className="h-screen bg-[#F4F6F9] flex font-sans select-none overflow-hidden">
      {/* Sidebar */}
      <aside className="w-72 bg-[#F7F8FA] flex flex-col h-full border-r border-slate-200 shrink-0">
        {/* Back to Dashboard */}
        <div className="px-4 pt-4 pb-2 border-b border-slate-100 bg-white">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 hover:text-slate-900 uppercase tracking-wider font-bold transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
          </button>
        </div>

        {/* Branding */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-slate-900 flex items-center justify-center font-black font-sans text-white text-xs shadow-premium">
              S
            </div>
            <div>
              <p className="font-sans font-bold text-xs tracking-tight text-slate-900 leading-none">Sage Workspace</p>
              <p className="text-[9px] uppercase tracking-widest font-mono text-slate-400 mt-1">Co-Founder Sync</p>
            </div>
          </div>
          <button
            onClick={async () => {
              const title = prompt("Workspace title?");
              if (!title?.trim()) return;
              const { data } = await supabase
                .from("notebooks").insert({ title: title.trim() })
                .select().maybeSingle();
              if (data) navigate(`/notebook/${(data as Notebook).id}`);
            }}
            className="p-1.5 bg-white hover:bg-slate-50 rounded-lg border border-slate-200 shadow-2xs transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>

        {/* Notebook List */}
        <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1.5 scrollbar-thin">
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold px-2 mb-1">
            Brainstorm Boards ({notebooks.length})
          </p>
          {notebooks.map((nb) => {
            const active = nb.id === activeNotebookId;
            return (
              <div
                key={nb.id}
                onClick={() => navigate(`/notebook/${nb.id}`)}
                className={`group flex items-center justify-between px-3 py-2.5 cursor-pointer transition-all ${
                  active
                    ? "bg-white text-slate-950 border-l-2 border-slate-900 font-semibold rounded-r-xl shadow-premium border border-slate-200 border-l-0"
                    : "border border-transparent hover:bg-slate-50 text-slate-500 rounded-xl"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${active ? "text-slate-850" : "text-slate-400"}`} />
                  <span className="text-2xs truncate">{nb.title}</span>
                </div>
                {nb.user_id === user?.id && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm("Delete this workspace?")) return;
                      await supabase.from("notebooks").delete().eq("id", nb.id);
                      navigate("/");
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-rose-600 transition ml-1 shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
          {notebooks.length === 0 && (
            <p className="text-3xs text-slate-400 font-mono px-3 py-4 text-center">No workspaces yet.</p>
          )}
        </div>

        {/* Collaborators Footer */}
        <div className="p-4 border-t border-slate-150 bg-slate-50/50 space-y-3.5">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 uppercase tracking-wider font-bold">
            <Activity className="w-3 h-3 text-slate-800 animate-pulse" />
            Active Online ({collaborators.length + 1})
          </div>

          <button
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="text-[10px] font-bold uppercase font-mono text-slate-600 hover:text-slate-900 transition flex items-center gap-1"
          >
            <Mail className="w-3 h-3" /> {showInviteForm ? "Cancel Invite" : "+ Invite Collaborator"}
          </button>

          {showInviteForm && (
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-premium space-y-2.5">
              {inviteError && (
                <div className="bg-rose-50 border border-rose-100 text-rose-800 rounded text-[9px] font-mono p-2">
                  ⚠️ {inviteError}
                </div>
              )}
              {inviteSuccess && (
                <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 rounded text-[9px] font-mono p-2">
                  ✅ Invitation sent!
                </div>
              )}
              <div>
                <label className="block text-[9px] font-mono uppercase text-slate-400 font-semibold mb-1">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="partner@example.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="block text-[9px] font-mono uppercase text-slate-400 font-semibold mb-1">Role</label>
                <input
                  type="text"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  placeholder="Co-Founder"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:border-slate-400"
                />
              </div>
              <button
                onClick={inviteCollaborator}
                disabled={isInviting}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-1.5 rounded-lg font-bold font-mono text-[9px] uppercase tracking-wider transition flex items-center justify-center gap-1 cursor-pointer"
              >
                {isInviting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                {isInviting ? "Sending..." : "Send Invite"}
              </button>
            </div>
          )}

          {/* Owner */}
          <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white shadow-3xs">
            <div className="relative">
              <div className="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center text-2xs font-bold font-sans">
                {profile?.avatar_initials || "?"}
              </div>
              <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white shadow-sm" />
            </div>
            <div className="min-w-0">
              <p className="text-2xs font-bold text-slate-800 truncate">{profile?.display_name || "You"}</p>
              <p className="text-[9px] text-slate-400 font-mono">Owner</p>
            </div>
          </div>

          {/* Collaborators */}
          {collaborators.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl border border-slate-100 opacity-40 bg-slate-50/50">
              <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-2xs font-bold font-sans text-slate-600">
                {c.profile?.avatar_initials || "?"}
              </div>
              <div className="min-w-0">
                <p className="text-2xs font-bold text-slate-800 truncate">{c.profile?.display_name || "Unknown"}</p>
                <p className="text-[9px] text-slate-400 font-mono">{c.role}</p>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden relative">
          {/* Editor */}
          <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-premium h-full relative">
            {/* Editorial Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-slate-900 text-white rounded-xl shadow-sm">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <input
                    value={notebook?.title || ""}
                    onChange={(e) => updateNotebookTitle(e.target.value)}
                    className="text-lg font-bold font-sans w-80 md:w-96 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none transition"
                  />
                  <p className="text-xs text-slate-400 font-mono mt-1">
                    Active Session • Last Saved: {new Date(notebook?.last_updated || Date.now()).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Voice control */}
                <button
                  onClick={() => {
                    if (isSpeaking) { stopSpeaking(); setIsSpeaking(false); }
                  }}
                  className={`p-2 rounded-xl border transition ${
                    isSpeaking
                      ? "bg-rose-50 border-rose-200 text-rose-600"
                      : "bg-white border-slate-200 text-slate-500 shadow-2xs"
                  }`}
                >
                  {isSpeaking ? (
                    <div className="flex items-center gap-1">
                      <Square className="w-3 h-3 fill-current animate-pulse" />
                      <span className="text-[10px] font-mono uppercase animate-pulse">Voice Active</span>
                      <div className="flex items-end gap-0.5 h-4">
                        <span className="w-0.5 bg-slate-400 rounded-full animate-wave-bar-1" />
                        <span className="w-0.5 bg-slate-400 rounded-full animate-wave-bar-2" />
                        <span className="w-0.5 bg-slate-400 rounded-full animate-wave-bar-3" />
                      </div>
                    </div>
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>

                {/* Share */}
                <button
                  onClick={() => setShareOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl transition shadow-2xs cursor-pointer"
                >
                  <Mail className="w-3.5 h-3.5" /> Share
                </button>

                {/* Analyze */}
                <button
                  onClick={() => setJarvisOpen(!jarvisOpen)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-white text-xs font-bold rounded-xl transition shadow-premium cursor-pointer ${
                    jarvisOpen ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-900 hover:bg-slate-800"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" /> {jarvisOpen ? "Hide Panel" : "Analyze"}
                </button>
              </div>
            </div>

            {/* Blocks Container */}
            <div
              className="flex-1 overflow-y-auto p-6 space-y-4 max-h-[calc(100vh-200px)] scrollbar-thin cursor-text"
              onClick={(e) => {
                if (e.target === e.currentTarget && blocks.length === 0) {
                  addBlock("text");
                }
              }}
            >
              {blocks.length === 0 && (
                <div className="h-full flex items-center justify-center">
                  <textarea
                    placeholder="Type here, or press / for options"
                    className="w-full h-full bg-transparent text-base text-slate-700 focus:outline-none resize-none placeholder:text-slate-300"
                    onFocus={() => addBlock("text")}
                    readOnly
                  />
                </div>
              )}

              {blocks.map((block) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  userId={user!.id}
                  authorName={profile?.display_name || "You"}
                  onUpdate={(updates) => updateBlock(block.id, updates)}
                  onDelete={() => deleteBlock(block.id)}
                  onVote={(optionId) => voteOnPoll(block.id, optionId)}
                />
              ))}

              {/* End placeholder */}
              {blocks.length > 0 && (
                <div
                  onClick={() => addBlock("text")}
                  className="py-4 px-4 text-slate-300 text-sm font-sans italic hover:text-slate-400 hover:bg-slate-50/30 rounded-xl cursor-pointer transition flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" /> Click to add a note...
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-slate-50 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                <p className="text-[10px] text-slate-400 font-mono">
                  Tip: Use the buttons above to add text, tables, or polls. Collaborators see updates on refresh.
                </p>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400">
                <Users className="w-3.5 h-3.5" /> {collaborators.length + 1} active
              </div>
            </div>
          </div>

          {/* Jarvis Panel */}
          <JarvisPanel
            notebookId={notebookId!}
            blocks={blocks}
            insight={insight}
            onInsightUpdate={setInsight}
            isOpen={jarvisOpen}
            onToggle={() => setJarvisOpen(!jarvisOpen)}
            onSpeak={handleSpeak}
            isSpeaking={isSpeaking}
            onStopSpeaking={() => { stopSpeaking(); setIsSpeaking(false); }}
          />
        </div>
      </div>

      {/* Share Modal */}
      <ShareModal
        notebook={notebook!}
        blocks={blocks}
        insight={insight}
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        onSpeak={handleSpeak}
        isSpeaking={isSpeaking}
      />
    </div>
  );
}

// ============================================================================
// Block Editor
// ============================================================================
function BlockEditor({
  block, userId, authorName, onUpdate, onDelete, onVote,
}: {
  block: NoteBlock;
  userId: string;
  authorName: string;
  onUpdate: (updates: Partial<NoteBlock>) => void;
  onDelete: () => void;
  onVote: (optionId: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const fontSizeClass = FONT_SIZES[block.font_size] || "text-base";

  if (block.type === "text" || block.type === "bullets") {
    return (
      <div
        className={`group border transition-all duration-200 py-3 relative px-4 rounded-xl ${
          isEditing
            ? "!border-slate-200 !bg-slate-50/30 shadow-premium"
            : "border-transparent bg-transparent hover:bg-slate-50/45"
        }`}
      >
        {/* Author attribution */}
        <div className="flex items-center gap-2 mb-2 select-none border-b border-slate-100/40 pb-1">
          <div className={`w-5 h-5 rounded-full ${getColorForName(authorName)} text-white flex items-center justify-center text-[9px] font-bold`}>
            {authorName.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase()}
          </div>
          <span className="text-2xs font-bold text-slate-700">{authorName}</span>
        </div>

        {/* Editing toolbar */}
        {isEditing && (
          <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-2.5 mb-1 gap-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => onUpdate({ bold: !block.bold })}
                className={`w-7 h-7 flex items-center justify-center rounded-lg border text-xs transition ${
                  block.bold ? "bg-blue-100 border-blue-300 text-blue-700 font-extrabold" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                B
              </button>
              <button
                onClick={() => onUpdate({ italic: !block.italic })}
                className={`w-7 h-7 flex items-center justify-center rounded-lg border text-xs transition ${
                  block.italic ? "bg-blue-100 border-blue-300 text-blue-700 italic font-serif" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                I
              </button>
              <button
                onClick={() => onUpdate({ font_size: block.font_size === "sm" ? "base" : block.font_size === "base" ? "lg" : block.font_size === "lg" ? "xl" : "sm" })}
                className="px-2 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 font-mono text-2xs uppercase font-bold transition"
              >
                {block.font_size || "base"}
              </button>
              <div className="flex items-center gap-1 ml-1">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => onUpdate({ highlight_color: block.highlight_color === c.name ? null : c.name })}
                    className={`w-3.5 h-3.5 rounded-full ${c.class} transition ${
                      block.highlight_color === c.name ? "ring-2 ring-blue-500 ring-offset-1 scale-110" : ""
                    }`}
                  />
                ))}
                <button
                  onClick={() => onUpdate({ highlight_color: null })}
                  className="text-[9px] font-mono text-slate-400 hover:text-slate-600 ml-0.5"
                >
                  Ø
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onDelete}
                className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-3xs font-bold uppercase font-mono px-2 py-1 rounded shadow-xs flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-3 h-3" /> Done
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <textarea
          value={block.content}
          onChange={(e) => onUpdate({ content: e.target.value })}
          onFocus={() => setIsEditing(true)}
          placeholder={block.type === "bullets" ? "Enter bullet points (one per line)..." : "Write your notes..."}
          className={`w-full bg-transparent border-none shadow-none focus:outline-none resize-none min-h-[60px] ${fontSizeClass} ${block.bold ? "font-bold" : ""} ${block.italic ? "italic" : ""} ${
            block.highlight_color === "amber" ? "bg-amber-200/50" : block.highlight_color === "emerald" ? "bg-emerald-200/50" : block.highlight_color === "sky" ? "bg-sky-200/50" : ""
          }`}
        />

        {/* Read mode hover actions */}
        {!isEditing && (
          <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition duration-150 flex gap-1">
            <button
              onClick={() => setIsEditing(true)}
              className="p-1.5 rounded-lg hover:bg-blue-50 hover:text-blue-600 text-slate-400 transition"
            >
              <Users className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }

  if (block.type === "table" && block.table_data) {
    const table = block.table_data;
    return (
      <div className="group border border-transparent bg-transparent transition-all duration-200 py-3 relative px-4 rounded-xl hover:bg-slate-50/45">
        <div className="flex items-center gap-2 mb-2 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-bold">
          <Table className="w-3.5 h-3.5 text-amber-500" /> Table Block
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 border border-slate-100 rounded-lg">
            <thead className="bg-slate-50">
              <tr>
                {table.headers.map((header, i) => (
                  <th key={i} className="px-3 py-2 text-left">
                    <input
                      value={header}
                      onChange={(e) => {
                        const headers = [...table.headers];
                        headers[i] = e.target.value;
                        onUpdate({ table_data: { ...table, headers } });
                      }}
                      className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none text-xs font-bold text-slate-500 uppercase tracking-wider font-mono"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {table.rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-slate-50/50">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2">
                      <input
                        value={cell}
                        onChange={(e) => {
                          const rows = table.rows.map((r) => [...r]);
                          rows[ri][ci] = e.target.value;
                          onUpdate({ table_data: { ...table, rows } });
                        }}
                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none text-sm text-slate-700"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => {
              const newTable: TableData = {
                ...table,
                rows: [...table.rows, table.headers.map(() => "")],
              };
              onUpdate({ table_data: newTable });
            }}
            className="text-[10px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md px-2 py-1 transition"
          >
            + Add Row
          </button>
          <button
            onClick={() => {
              const newTable: TableData = {
                ...table,
                headers: [...table.headers, `Column ${table.headers.length + 1}`],
                rows: table.rows.map((r) => [...r, ""]),
              };
              onUpdate({ table_data: newTable });
            }}
            className="text-[10px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md px-2 py-1 transition"
          >
            + Add Column
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition ml-auto"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  if (block.type === "poll" && block.poll_data) {
    const poll = block.poll_data;
    const hasVoted = poll.voted_user_ids.includes(userId);
    const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
    return (
      <div className="group border border-transparent bg-transparent transition-all duration-200 py-3 relative px-4 rounded-xl hover:bg-slate-50/45">
        <div className="flex items-center gap-2 mb-3 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-bold">
          <Check className="w-3.5 h-3.5 text-blue-500" /> Poll Block
        </div>
        <input
          value={poll.question}
          onChange={(e) => onUpdate({ poll_data: { ...poll, question: e.target.value } })}
          placeholder="Poll question..."
          className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none text-base font-bold text-slate-800 mb-3"
        />
        <div className="space-y-2">
          {poll.options.map((opt) => {
            const pct = totalVotes > 0 ? (opt.votes / totalVotes) * 100 : 0;
            return (
              <div key={opt.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onVote(opt.id)}
                    disabled={hasVoted}
                    className={`relative flex-1 p-2.5 rounded-lg border overflow-hidden text-left transition ${
                      hasVoted ? "border-slate-200/80 cursor-default" : "border-slate-200/80 hover:border-blue-300 cursor-pointer"
                    }`}
                  >
                    {hasVoted && (
                      <div
                        className="absolute inset-0 bg-blue-500/10 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    )}
                    <span className="relative text-xs text-slate-700 font-semibold">{opt.text || "Option"}</span>
                    {hasVoted && (
                      <span className="relative float-right text-[10px] font-mono text-slate-500">
                        {opt.votes} ({pct.toFixed(0)}%)
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      const updated: PollData = {
                        ...poll,
                        options: poll.options.filter((o) => o.id !== opt.id),
                      };
                      onUpdate({ poll_data: updated });
                    }}
                    className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
          {!hasVoted && (
            <button
              onClick={() => {
                const updated: PollData = {
                  ...poll,
                  options: [...poll.options, { id: crypto.randomUUID(), text: "", votes: 0 }],
                };
                onUpdate({ poll_data: updated });
              }}
              className="text-[10px] font-mono text-blue-600 hover:text-blue-700 transition flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add option
            </button>
          )}
        </div>
        {hasVoted && (
          <p className="mt-2 text-[10px] font-mono text-slate-400">
            {totalVotes} {totalVotes === 1 ? "vote" : "votes"} total
          </p>
        )}
        <button
          onClick={onDelete}
          className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return null;
}
