import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { speakText, stopSpeaking, isSpeechSynthesisAvailable } from "@/utils/speechUtils";
import type {
  Notebook, NoteBlock, BlockType, TableData, PollData,
  Collaborator, Profile, JarvisInsight, BulletStyle,
} from "@/lib/types";
import {
  Plus, Table as TableIcon, List, Type, Check, Trash2,
  Sparkles, Volume2, Square, ArrowLeft, Users, Mail,
  Send, Loader2, MessageSquare, Activity,
  ChevronRight, ArrowRight, Circle, CheckSquare, Hash, X,
} from "lucide-react";
import { toast } from "sonner";
import JarvisPanel from "@/components/jarvis-panel";
import ShareModal from "@/components/share-modal";

const FONT_SIZES: Record<string, string> = {
  sm: "text-sm", base: "text-base", lg: "text-lg", xl: "text-xl",
};

const HIGHLIGHT_COLORS = [
  { class: "bg-amber-200", name: "amber", wrapClass: "bg-amber-100/60" },
  { class: "bg-emerald-200", name: "emerald", wrapClass: "bg-emerald-100/60" },
  { class: "bg-sky-200", name: "sky", wrapClass: "bg-sky-100/60" },
  { class: "bg-rose-200", name: "rose", wrapClass: "bg-rose-100/60" },
];

const COLLAB_COLORS = ["bg-indigo-600", "bg-emerald-600", "bg-blue-600", "bg-amber-600", "bg-slate-600"];

const BULLET_STYLES: { value: BulletStyle; label: string; icon: typeof Circle }[] = [
  { value: "dot", label: "Dot", icon: Circle },
  { value: "arrow", label: "Arrow", icon: ArrowRight },
  { value: "checkbox", label: "Checkbox", icon: CheckSquare },
  { value: "numbered", label: "Numbered", icon: Hash },
];

const SLASH_COMMANDS: { type: BlockType; label: string; desc: string; icon: typeof Type }[] = [
  { type: "text", label: "Text", desc: "Write a paragraph of notes", icon: Type },
  { type: "bullets", label: "Bullets", desc: "Bulleted list with styles and nesting", icon: List },
  { type: "table", label: "Table", desc: "Editable grid with rows and columns", icon: TableIcon },
  { type: "poll", label: "Poll", desc: "Vote on options with your team", icon: Check },
];

function getColorForName(name: string) {
  const hash = name.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}

function getHighlightWrapClass(color: string | null | undefined): string {
  const found = HIGHLIGHT_COLORS.find((c) => c.name === color);
  return found ? found.wrapClass : "";
}

function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? Math.floor(match[1].length / 2) : 0;
}

export default function NotebookPage() {
  const { notebookId } = useParams<{ notebookId: string }>();
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [blocks, setBlocks] = useState<NoteBlock[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [ownerProfile, setOwnerProfile] = useState<Profile | null>(null);
  const [activeUsers, setActiveUsers] = useState<Profile[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [jarvisOpen, setJarvisOpen] = useState(false);
  const [insight, setInsight] = useState<JarvisInsight | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [blockAuthors, setBlockAuthors] = useState<Map<string, Profile>>(new Map());

  // Sidebar state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Co-Founder");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  // Slash command state
  const [slashOpen, setSlashOpen] = useState(false);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  const loadNotebook = useCallback(async () => {
    if (!notebookId) return;
    setLoading(true);

    const { data: nb } = await supabase
      .from("notebooks").select("*").eq("id", notebookId).maybeSingle();
    if (!nb) { toast.error("Notebook not found"); navigate("/"); return; }
    setNotebook(nb as Notebook);

    const { data: ownerProf } = await supabase
      .from("profiles").select("*").eq("id", nb.user_id).maybeSingle();
    if (ownerProf) setOwnerProfile(ownerProf as Profile);

    const { data: blks } = await supabase
      .from("note_blocks").select("*").eq("notebook_id", notebookId)
      .order("position", { ascending: true });
    const blockList = (blks as NoteBlock[]) || [];
    setBlocks(blockList);

    // Fetch author profiles
    const authorIds = [...new Set(blockList.map((b) => b.user_id).filter(Boolean))];
    if (authorIds.length > 0) {
      const { data: authorProfiles } = await supabase
        .from("profiles").select("*").in("id", authorIds);
      if (authorProfiles) {
        setBlockAuthors(new Map((authorProfiles as Profile[]).map((p) => [p.id, p])));
      }
    }

    // Fetch collaborators with profiles in the same query
    const { data: collabs } = await supabase
      .from("notebook_collaborators").select("*").eq("notebook_id", notebookId);
    const collabList = (collabs as Collaborator[]) || [];

    // Fetch collaborator profiles
    if (collabList.length > 0) {
      const collabUserIds = collabList.map((c) => c.user_id);
      const { data: collabProfiles } = await supabase
        .from("profiles").select("*").in("id", collabUserIds);
      const profileMap = new Map<string, Profile>(
        (collabProfiles as Profile[])?.map((p) => [p.id, p]) || []
      );
      setCollaborators(collabList.map((c) => ({ ...c, profile: profileMap.get(c.user_id) })));
    } else {
      setCollaborators([]);
    }

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

  // Setup Real-time Subscriptions
  useEffect(() => {
    if (!notebookId || !profile) return;

    // Real-time note blocks
    const blockChannel = supabase
      .channel(`public:note_blocks:notebook_id=${notebookId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "note_blocks",
          filter: `notebook_id=eq.${notebookId}`,
        },
        () => {
          // Robust real-time sync by reloading blocks when changes occur
          supabase
            .from("note_blocks")
            .select("*")
            .eq("notebook_id", notebookId)
            .order("position", { ascending: true })
            .then(async ({ data: blks }) => {
              const blockList = (blks as NoteBlock[]) || [];
              setBlocks(blockList);
              const authorIds = [...new Set(blockList.map((b) => b.user_id).filter(Boolean))];
              if (authorIds.length > 0) {
                const { data: authorProfiles } = await supabase
                  .from("profiles").select("*").in("id", authorIds);
                if (authorProfiles) {
                  setBlockAuthors(new Map((authorProfiles as Profile[]).map((p) => [p.id, p])));
                }
              }
            });
        }
      )
      .subscribe();

    // Presence
    const presenceChannel = supabase.channel(`presence:notebook_${notebookId}`, {
      config: { presence: { key: profile.id } }
    });

    presenceChannel
      .on("presence", { event: "sync" }, () => {
        const state = presenceChannel.presenceState();
        const profiles: Profile[] = [];
        for (const id in state) {
          const userState = state[id][0] as any;
          if (userState?.profile) profiles.push(userState.profile);
        }
        setActiveUsers(profiles);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presenceChannel.track({ profile });
        }
      });

    return () => {
      supabase.removeChannel(blockChannel);
      supabase.removeChannel(presenceChannel);
    };
  }, [notebookId, profile]);

  async function updateNotebookTitle(title: string) {
    if (!notebookId || !notebook) return;
    setNotebook({ ...notebook, title });
    await supabase.from("notebooks").update({ title }).eq("id", notebookId);
  }

  async function addBlock(type: BlockType) {
    if (!notebookId) return;
    const position = blocks.length;
    const newBlock: any = {
      notebook_id: notebookId,
      position,
      type,
      content: "",
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
    } else if (type === "bullets") {
      newBlock.bullet_style = "dot";
      newBlock.content = "";
    }
    const { data, error } = await supabase
      .from("note_blocks").insert(newBlock).select().maybeSingle();
    if (error) { toast.error("Failed to add block"); return; }
    setBlocks([...blocks, data as NoteBlock]);
  }

  async function updateBlock(id: string, updates: Partial<NoteBlock>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...updates } : b)));
    const { table_data, poll_data, content, bullet_style, ...rest } = updates;
    const dbUpdates: any = { ...rest, updated_at: new Date().toISOString() };
    if (content !== undefined) dbUpdates.content = content;
    if (table_data !== undefined) dbUpdates.table_data = table_data;
    if (poll_data !== undefined) dbUpdates.poll_data = poll_data;
    if (bullet_style !== undefined) dbUpdates.bullet_style = bullet_style;
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
            role: inviteRole,
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

  async function handleSpeak(text: string) {
    if (isSpeaking) { stopSpeaking(); setIsSpeaking(false); return; }
    if (!text.trim()) { toast.error("No text to read"); return; }
    if (!isSpeechSynthesisAvailable()) {
      toast.error("Text-to-speech is not supported in this browser");
      return;
    }
    setIsSpeaking(true);
    toast.success("Reading notes aloud...");
    const ok = await speakText(text, undefined, () => setIsSpeaking(false));
    if (!ok) {
      setIsSpeaking(false);
      toast.error("Could not play audio — check your browser's sound settings");
    }
  }

  // Slash command: add block at end with type
  function handleSlashSelect(type: BlockType) {
    addBlock(type);
    setSlashOpen(false);
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
          <div className="flex items-center justify-between p-2 rounded-xl border border-slate-200 bg-white shadow-3xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0">
                <div className="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center text-2xs font-bold font-sans">
                  {ownerProfile?.avatar_initials || "?"}
                </div>
                {activeUsers.find(u => u.id === ownerProfile?.id) && (
                  <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white shadow-sm" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-2xs font-bold text-slate-800 truncate">{ownerProfile?.display_name || "Owner"}</p>
                <p className="text-[9px] text-slate-400 font-mono">Owner</p>
              </div>
            </div>
            {profile?.id === ownerProfile?.id && (
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest shrink-0 ml-2 bg-slate-50 px-1.5 py-0.5 rounded">You</span>
            )}
          </div>

          {/* Collaborators */}
          {collaborators.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-xl border border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="relative shrink-0">
                  <div className={`w-7 h-7 rounded-full ${getColorForName(c.profile?.display_name || "?")} text-white flex items-center justify-center text-2xs font-bold font-sans`}>
                    {c.profile?.avatar_initials || "?"}
                  </div>
                  {activeUsers.find(u => u.id === c.user_id) && (
                    <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white shadow-sm" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-2xs font-bold text-slate-800 truncate">{c.profile?.display_name || "Unknown"}</p>
                  <p className="text-[9px] text-slate-400 font-mono">{c.role}</p>
                </div>
              </div>
              {profile?.id === c.user_id && (
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest shrink-0 ml-2 bg-slate-200/50 px-1.5 py-0.5 rounded">You</span>
              )}
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
                    else {
                      const fullText = blocks
                        .map(b => b.type === "text" || b.type === "bullets" ? b.content : "")
                        .filter(Boolean).join(". ");
                      handleSpeak(fullText);
                    }
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

            {/* Block type toolbar */}
            <div className="px-6 py-2.5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider mr-1">Add:</span>
              <button
                onClick={() => addBlock("text")}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:border-slate-400 hover:bg-slate-50 text-slate-700 text-2xs font-bold rounded-lg transition shadow-2xs cursor-pointer"
              >
                <Type className="w-3 h-3" /> Text
              </button>
              <button
                onClick={() => addBlock("bullets")}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:border-slate-400 hover:bg-slate-50 text-slate-700 text-2xs font-bold rounded-lg transition shadow-2xs cursor-pointer"
              >
                <List className="w-3 h-3" /> Bullets
              </button>
              <button
                onClick={() => addBlock("table")}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:border-slate-400 hover:bg-slate-50 text-slate-700 text-2xs font-bold rounded-lg transition shadow-2xs cursor-pointer"
              >
                <TableIcon className="w-3 h-3" /> Table
              </button>
              <button
                onClick={() => addBlock("poll")}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:border-slate-400 hover:bg-slate-50 text-slate-700 text-2xs font-bold rounded-lg transition shadow-2xs cursor-pointer"
              >
                <Check className="w-3 h-3" /> Poll
              </button>
              <div className="ml-auto text-[9px] font-mono text-slate-400">
                Tip: Press <kbd className="px-1 py-0.5 bg-slate-200 rounded text-[8px]">/</kbd> in empty area for quick add
              </div>
            </div>

            {/* Blocks Container */}
            <div
              className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[calc(100vh-260px)] scrollbar-thin"
              onClick={(e) => {
                if (e.target === e.currentTarget && blocks.length === 0) {
                  setSlashOpen(true);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "/" && blocks.length === 0 && e.target === e.currentTarget) {
                  e.preventDefault();
                  setSlashOpen(true);
                }
              }}
              tabIndex={0}
            >
              {blocks.length === 0 && !slashOpen && (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
                  <Sparkles className="w-8 h-8 text-slate-300" />
                  <p className="text-sm text-slate-400 font-sans">This brainstorm board is empty.</p>
                  <p className="text-2xs text-slate-400 font-mono">Use the toolbar above or press / to add text, bullets, tables, or polls.</p>
                </div>
              )}

              {/* Slash command menu */}
              {slashOpen && (
                <div className="flex items-center justify-center">
                  <div
                    ref={slashMenuRef}
                    className="bg-white rounded-xl border border-slate-200 shadow-premium p-2 w-80 z-20"
                  >
                    <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider px-2 py-1.5">
                      Insert a block
                    </p>
                    {SLASH_COMMANDS.map((cmd) => {
                      const Icon = cmd.icon;
                      return (
                        <button
                          key={cmd.type}
                          onClick={() => handleSlashSelect(cmd.type)}
                          className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 transition text-left"
                        >
                          <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                            <Icon className="w-4 h-4 text-slate-600" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-800">{cmd.label}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{cmd.desc}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-300 ml-auto" />
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setSlashOpen(false)}
                      className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-mono text-slate-400 hover:text-slate-600 transition"
                    >
                      <X className="w-3 h-3" /> Close
                    </button>
                  </div>
                </div>
              )}

              {blocks.map((block) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  userId={user!.id}
                  authorName={blockAuthors.get(block.user_id)?.display_name || profile?.display_name || "Unknown"}
                  authorInitials={blockAuthors.get(block.user_id)?.avatar_initials || "?"}
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
                  <Plus className="w-4 h-4" /> Click to add a text note...
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-slate-50 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-[10px] text-slate-400 font-mono">
                  All changes are saved and synced in real-time. Only block authors can edit their own blocks.
                </p>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400">
                <div className="flex items-center -space-x-2 mr-2">
                  {activeUsers.map((u) => (
                    <div key={u.id} className={`w-6 h-6 rounded-full border-2 border-slate-50 ${getColorForName(u.display_name || "?")} text-white flex items-center justify-center text-[8px] font-bold z-10`} title={u.display_name}>
                      {u.avatar_initials || "?"}
                    </div>
                  ))}
                </div>
                <Users className="w-3.5 h-3.5" /> {activeUsers.length} online
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
  block, userId, authorName, authorInitials, onUpdate, onDelete, onVote,
}: {
  block: NoteBlock;
  userId: string;
  authorName: string;
  authorInitials: string;
  onUpdate: (updates: Partial<NoteBlock>) => void;
  onDelete: () => void;
  onVote: (optionId: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const fontSizeClass = FONT_SIZES[block.font_size] || "text-base";
  const isOwner = block.user_id === userId;
  const highlightWrap = getHighlightWrapClass(block.highlight_color);

  // Prevent empty text blocks from rendering for non-owners
  if (block.type === "text" && !block.content?.trim() && !isOwner) {
    return null;
  }

  // ========================================================================
  // TEXT & BULLETS
  // ========================================================================
  if (block.type === "text" || block.type === "bullets") {
    return (
      <div
        className={`group border transition-all duration-200 py-2 relative px-3 rounded-xl ${
          isEditing
            ? "border-slate-200 bg-slate-50/30 shadow-premium"
            : "border-transparent bg-transparent hover:bg-slate-50/45"
        } ${highlightWrap}`}
      >
        {/* Author attribution */}
        <div className="flex items-center gap-1.5 mb-0.5 select-none opacity-60">
          <div className={`w-3.5 h-3.5 rounded-full ${getColorForName(authorName)} text-white flex items-center justify-center text-[7px] font-bold`}>
            {authorInitials}
          </div>
          <span className="text-[9px] font-bold text-slate-700">{authorName}</span>
          {isOwner && (
            <span className="text-[8px] text-slate-400 font-mono">Author</span>
          )}
          {/* Bullet style selector */}
          {block.type === "bullets" && isOwner && (
            <div className="flex items-center gap-0.5 ml-auto">
              {BULLET_STYLES.map((bs) => {
                const Icon = bs.icon;
                const active = (block.bullet_style || "dot") === bs.value;
                return (
                  <button
                    key={bs.value}
                    onClick={() => onUpdate({ bullet_style: bs.value })}
                    className={`w-5 h-5 flex items-center justify-center rounded transition ${
                      active ? "bg-blue-100 text-blue-700" : "text-slate-400 hover:bg-slate-100"
                    }`}
                    title={bs.label}
                  >
                    <Icon className="w-3 h-3" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Editing toolbar */}
        {isEditing && isOwner && block.type === "text" && (
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
                    title={c.name}
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
        {block.type === "bullets" ? (
          <BulletEditor
            content={block.content}
            bulletStyle={block.bullet_style || "dot"}
            readOnly={!isOwner}
            onChange={(content) => onUpdate({ content })}
            onEditEnter={() => setIsEditing(true)}
            onDelete={onDelete}
            isEditing={isEditing}
            setIsEditing={setIsEditing}
          />
        ) : (
          <textarea
            autoFocus={isOwner && !block.content}
            value={block.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            onFocus={() => isOwner && setIsEditing(true)}
            onBlur={(e) => {
              setIsEditing(false);
              if (isOwner && !e.target.value.trim()) {
                onDelete();
              }
            }}
            readOnly={!isOwner}
            placeholder="Write your notes..."
            className={`w-full bg-transparent border-none shadow-none focus:outline-none resize-none min-h-[40px] ${fontSizeClass} ${block.bold ? "font-bold" : ""} ${block.italic ? "italic" : ""} ${!isOwner ? "cursor-default" : "cursor-text"}`}
          />
        )}

        {/* Read mode hover actions */}
        {!isEditing && isOwner && block.type === "text" && (
          <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition duration-150 flex gap-1">
            <button
              onClick={() => setIsEditing(true)}
              className="p-1.5 rounded-lg hover:bg-blue-50 hover:text-blue-600 text-slate-400 transition"
            >
              <Users className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Delete button for bullets when owner */}
        {!isEditing && isOwner && block.type === "bullets" && (
          <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition duration-150 flex gap-1">
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // ========================================================================
  // TABLE
  // ========================================================================
  if (block.type === "table" && block.table_data) {
    const table = block.table_data;
    return (
      <div className="group border border-slate-200 bg-white transition-all duration-200 py-3 relative px-4 rounded-xl hover:shadow-premium">
        <div className="flex items-center gap-2 mb-3 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-bold">
          <TableIcon className="w-3.5 h-3.5 text-amber-500" /> Table Block
          {!isOwner && <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded normal-case tracking-normal">Read-only</span>}
          {isOwner && (
            <button
              onClick={onDelete}
              className="ml-auto p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b-2 border-slate-200">
                {table.headers.map((header, i) => (
                  <th key={i} className="px-3 py-2 text-left border-r border-slate-200 last:border-r-0">
                    <input
                      value={header}
                      readOnly={!isOwner}
                      onChange={(e) => {
                        const headers = [...table.headers];
                        headers[i] = e.target.value;
                        onUpdate({ table_data: { ...table, headers } });
                      }}
                      className={`w-full bg-transparent border-none ${isOwner ? "focus:outline-none focus:border-blue-500" : "cursor-default"} text-xs font-bold text-slate-700 uppercase tracking-wider font-mono`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-slate-200 last:border-b-0 hover:bg-slate-50/50">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 border-r border-slate-200 last:border-r-0">
                      <input
                        value={cell}
                        readOnly={!isOwner}
                        onChange={(e) => {
                          const rows = table.rows.map((r) => [...r]);
                          rows[ri][ci] = e.target.value;
                          onUpdate({ table_data: { ...table, rows } });
                        }}
                        className={`w-full bg-transparent border-none ${isOwner ? "focus:outline-none focus:text-blue-600" : "cursor-default"} text-sm text-slate-700`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isOwner && (
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
          </div>
        )}
      </div>
    );
  }

  // ========================================================================
  // POLL
  // ========================================================================
  if (block.type === "poll" && block.poll_data) {
    return (
      <PollBlock
        poll={block.poll_data}
        isOwner={isOwner}
        userId={userId}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onVote={onVote}
      />
    );
  }

  return null;
}

// ============================================================================
// Bullet Editor — visual bullets with nesting support
// ============================================================================
function BulletEditor({
  content, bulletStyle, readOnly, onChange, onEditEnter, onDelete,
  isEditing, setIsEditing,
}: {
  content: string;
  bulletStyle: BulletStyle;
  readOnly: boolean;
  onChange: (content: string) => void;
  onEditEnter: () => void;
  onDelete: () => void;
  isEditing: boolean;
  setIsEditing: (v: boolean) => void;
}) {
  // Local lines state — sync to parent only on blur to avoid re-render focus loss
  const [localLines, setLocalLines] = useState<string[]>(() => {
    const split = content.split("\n");
    return split.length === 0 ? [""] : split;
  });
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Sync in from parent only if content changed externally (bullet_style update etc.)
  useEffect(() => {
    const currentJoined = localLines.join("\n");
    if (content !== currentJoined) {
      setLocalLines(content ? content.split("\n") : [""]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // Focus management
  useEffect(() => {
    if (focusLine !== null && inputRefs.current[focusLine]) {
      inputRefs.current[focusLine]!.focus();
      setFocusLine(null);
    }
  }, [localLines, focusLine]);

  function commit(lines: string[]) {
    setLocalLines(lines);
    onChange(lines.join("\n"));
  }

  function getBulletIcon(style: BulletStyle, index: number, indent: number) {
    const indentPx = indent * 20;
    if (style === "arrow") return <span style={{ paddingLeft: indentPx }} className="text-slate-400 select-none">→</span>;
    if (style === "checkbox") return <span style={{ paddingLeft: indentPx }} className="text-slate-400 select-none">☐</span>;
    if (style === "numbered") return <span style={{ paddingLeft: indentPx }} className="text-slate-400 select-none font-mono text-[10px]">{index + 1}.</span>;
    return <span style={{ paddingLeft: indentPx }} className="text-slate-400 select-none">•</span>;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, lineIndex: number) {
    if (readOnly) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const newLines = [...localLines];
      const currentIndent = getIndentLevel(newLines[lineIndex]);
      newLines.splice(lineIndex + 1, 0, "  ".repeat(currentIndent));
      setFocusLine(lineIndex + 1);
      commit(newLines);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const newLines = [...localLines];
      const currentIndent = getIndentLevel(newLines[lineIndex]);
      if (e.shiftKey && currentIndent > 0) {
        newLines[lineIndex] = newLines[lineIndex].replace(/^  /, "");
      } else {
        newLines[lineIndex] = "  " + newLines[lineIndex];
      }
      commit(newLines);
    } else if (e.key === "Backspace" && localLines[lineIndex].trimStart() === "" && localLines.length > 1) {
      e.preventDefault();
      const newLines = localLines.filter((_, i) => i !== lineIndex);
      setFocusLine(Math.max(0, lineIndex - 1));
      commit(newLines);
    }
  }

  function updateLine(lineIndex: number, value: string) {
    const currentIndent = getIndentLevel(localLines[lineIndex]);
    const newLines = [...localLines];
    newLines[lineIndex] = "  ".repeat(currentIndent) + value;
    setLocalLines(newLines);
  }

  function flushLine(lineIndex: number, value: string) {
    const currentIndent = getIndentLevel(localLines[lineIndex]);
    const newLines = [...localLines];
    newLines[lineIndex] = "  ".repeat(currentIndent) + value;
    commit(newLines);
  }

  function addLine() {
    const newLines = [...localLines, ""];
    setFocusLine(newLines.length - 1);
    commit(newLines);
  }

  if (readOnly) {
    return (
      <div className="space-y-1">
        {localLines.length === 0 || (localLines.length === 1 && localLines[0] === "") ? (
          <p className="text-sm text-slate-400 italic">No bullet points yet.</p>
        ) : (
          localLines.map((line, i) => {
            const indent = getIndentLevel(line);
            const text = line.trimStart();
            if (!text) return null;
            return (
              <div key={i} className="flex items-start gap-2 text-sm text-slate-700">
                {getBulletIcon(bulletStyle, i, indent)}
                <span>{text}</span>
              </div>
            );
          })
        )}
      </div>
    );
  }

  // Editable: per-line inputs with keyboard nesting
  return (
    <div className="space-y-1" onFocus={onEditEnter}>
      {localLines.map((line, i) => {
        const indent = getIndentLevel(line);
        const text = line.trimStart();
        return (
          <div key={i} className="flex items-start gap-2">
            {getBulletIcon(bulletStyle, i, indent)}
            <input
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              value={text}
              onChange={(e) => updateLine(i, e.target.value)}
              onBlur={(e) => flushLine(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              placeholder="Type a bullet point..."
              className="flex-1 text-sm text-slate-700 bg-transparent border-none focus:outline-none focus:text-blue-600"
            />
          </div>
        );
      })}
      {isEditing && (
        <>
          <button
            onClick={addLine}
            className="text-[10px] font-mono text-slate-400 hover:text-slate-600 transition flex items-center gap-1 pt-1"
          >
            <Plus className="w-3 h-3" /> Add bullet
          </button>
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100 mt-2">
            <span className="text-[9px] font-mono text-slate-400">Tab = indent • Shift+Tab = outdent • Enter = new line</span>
            <button
              onClick={() => setIsEditing(false)}
              className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white text-3xs font-bold uppercase font-mono px-2 py-1 rounded shadow-xs flex items-center gap-1 cursor-pointer"
            >
              <Check className="w-3 h-3" /> Done
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// PollBlock — edit mode toggle hides option inputs until owner clicks "Edit"
// ============================================================================
function PollBlock({
  poll, isOwner, userId, onUpdate, onDelete, onVote,
}: {
  poll: PollData;
  isOwner: boolean;
  userId: string;
  onUpdate: (updates: Partial<NoteBlock>) => void;
  onDelete: () => void;
  onVote: (optionId: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const hasVoted = poll.voted_user_ids.includes(userId);
  const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);

  return (
    <div className="group border border-slate-200 bg-white transition-all duration-200 py-3 relative px-4 rounded-xl hover:shadow-premium">
      <div className="flex items-center gap-2 mb-3 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-bold">
        <Check className="w-3.5 h-3.5 text-blue-500" /> Poll Block
        {!isOwner && <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded normal-case tracking-normal">Read-only</span>}
        {isOwner && (
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider transition ${
                isEditing
                  ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                  : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200"
              }`}
            >
              {isEditing ? "Done" : "Edit"}
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {isEditing && isOwner ? (
        <input
          value={poll.question}
          onChange={(e) => onUpdate({ poll_data: { ...poll, question: e.target.value } })}
          placeholder="Poll question..."
          className="w-full bg-transparent border-b border-blue-400 focus:outline-none text-base font-bold text-slate-800 mb-3"
        />
      ) : (
        <p className="text-base font-bold text-slate-800 mb-3">
          {poll.question || "Untitled poll"}
        </p>
      )}

      <div className="space-y-2">
        {poll.options.map((opt, idx) => {
          const pct = totalVotes > 0 ? (opt.votes / totalVotes) * 100 : 0;
          return (
            <div key={opt.id} className="space-y-1">
              {isEditing && isOwner ? (
                <div className="flex items-center gap-2">
                  <input
                    value={opt.text}
                    onChange={(e) => {
                      const updated: PollData = {
                        ...poll,
                        options: poll.options.map((o) =>
                          o.id === opt.id ? { ...o, text: e.target.value } : o
                        ),
                      };
                      onUpdate({ poll_data: updated });
                    }}
                    placeholder={`Option ${idx + 1} text...`}
                    className="flex-1 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                  />
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
              ) : (
                <button
                  onClick={() => onVote(opt.id)}
                  disabled={hasVoted}
                  className={`relative w-full p-2.5 rounded-lg border overflow-hidden text-left transition ${
                    hasVoted ? "border-slate-300 cursor-default" : "border-slate-200 hover:border-blue-400 cursor-pointer bg-slate-50"
                  }`}
                >
                  {hasVoted && (
                    <div
                      className="absolute inset-0 bg-blue-500/10 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  )}
                  <span className="relative text-xs text-slate-700 font-semibold">
                    {opt.text || `Option ${idx + 1}`}
                  </span>
                  {hasVoted && (
                    <span className="relative float-right text-[10px] font-mono text-slate-500">
                      {opt.votes} ({pct.toFixed(0)}%)
                    </span>
                  )}
                </button>
              )}
            </div>
          );
        })}
        {isEditing && isOwner && (
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
      {hasVoted && !isEditing && (
        <p className="mt-2 text-[10px] font-mono text-slate-400">
          {totalVotes} {totalVotes === 1 ? "vote" : "votes"} total
        </p>
      )}
    </div>
  );
}
