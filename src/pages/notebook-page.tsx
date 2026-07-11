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

interface ActiveUserPresence {
  profile: Profile;
  isTyping?: boolean;
  typingBlockId?: string | null;
  tabId?: string;
}

export default function NotebookPage() {
  const { notebookId } = useParams<{ notebookId: string }>();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const tabIdRef = useRef<string>(crypto.randomUUID());
  const myTabId = tabIdRef.current;

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [blocks, setBlocks] = useState<NoteBlock[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [ownerProfile, setOwnerProfile] = useState<Profile | null>(null);
  const [activeUsers, setActiveUsers] = useState<Profile[]>([]);
  const [activePresences, setActivePresences] = useState<ActiveUserPresence[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [jarvisOpen, setJarvisOpen] = useState(false);
  const [insight, setInsight] = useState<JarvisInsight | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [blockAuthors, setBlockAuthors] = useState<Map<string, Profile>>(new Map());

  const presenceChannelRef = useRef<any>(null);
  const isTypingRef = useRef<{ blockId: string | null }>({ blockId: null });
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const locallyCreatedBlockIdsRef = useRef<Set<string>>(new Set());

  const handleTyping = useCallback((blockId: string | null) => {
    if (!presenceChannelRef.current || !profile) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    if (isTypingRef.current.blockId !== blockId) {
      isTypingRef.current.blockId = blockId;
      presenceChannelRef.current.track({
        profile,
        isTyping: !!blockId,
        typingBlockId: blockId,
        tabId: myTabId,
      });
    }

    if (blockId) {
      typingTimeoutRef.current = setTimeout(() => {
        isTypingRef.current.blockId = null;
        presenceChannelRef.current?.track({
          profile,
          isTyping: false,
          typingBlockId: null,
          tabId: myTabId,
        });
      }, 3000);
    }
  }, [profile, myTabId]);



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
      config: { presence: { key: myTabId } }
    });
    presenceChannelRef.current = presenceChannel;

    presenceChannel
      .on("presence", { event: "sync" }, () => {
        const state = presenceChannel.presenceState();
        
        // Group and keep only the latest presence payload for each unique tabId
        const latestPresences = new Map<string, any>();
        for (const id in state) {
          state[id].forEach((userState: any) => {
            if (userState?.profile && userState.tabId) {
              latestPresences.set(userState.tabId, userState);
            }
          });
        }

        const profiles: Profile[] = [];
        const presences: ActiveUserPresence[] = [];
        
        latestPresences.forEach((userState) => {
          if (!profiles.some(p => p.id === userState.profile.id)) {
            profiles.push(userState.profile);
          }
          presences.push({
            profile: userState.profile,
            isTyping: userState.isTyping,
            typingBlockId: userState.typingBlockId,
            tabId: userState.tabId,
          });
        });

        setActiveUsers(profiles);
        setActivePresences(presences);
      })
      .on("broadcast", { event: "block-changed" }, ({ payload }) => {
        if (payload.senderTabId === myTabId) return;

        if (payload.type === "insert") {
          setBlocks((prev) => {
            if (prev.some((b) => b.id === payload.block.id)) return prev;
            const updatedList = [...prev, payload.block];
            return updatedList.sort((a, b) => a.position - b.position);
          });
          const authorId = payload.block.user_id;
          if (authorId) {
            supabase
              .from("profiles")
              .select("*")
              .eq("id", authorId)
              .single()
              .then(({ data: profileData }) => {
                if (profileData) {
                  setBlockAuthors((prev) => {
                    const next = new Map(prev);
                    next.set(authorId, profileData);
                    return next;
                  });
                }
              });
          }
        } else if (payload.type === "update") {
          setBlocks((prev) =>
            prev.map((b) => (b.id === payload.blockId ? { ...b, ...payload.updates } : b))
          );
        } else if (payload.type === "delete") {
          setBlocks((prev) => prev.filter((b) => b.id !== payload.blockId));
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presenceChannel.track({ profile, tabId: myTabId });
        }
      });

    return () => {
      supabase.removeChannel(blockChannel);
      supabase.removeChannel(presenceChannel);
      presenceChannelRef.current = null;
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
    if (data) {
      locallyCreatedBlockIdsRef.current.add(data.id);
    }
    setBlocks([...blocks, data as NoteBlock]);

    presenceChannelRef.current?.send({
      type: "broadcast",
      event: "block-changed",
      payload: { type: "insert", block: data, senderTabId: myTabId }
    });
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

    presenceChannelRef.current?.send({
      type: "broadcast",
      event: "block-changed",
      payload: { type: "update", blockId: id, updates, senderTabId: myTabId }
    });
  }

  async function deleteBlock(id: string) {
    handleTyping(null);
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    await supabase.from("note_blocks").delete().eq("id", id);

    presenceChannelRef.current?.send({
      type: "broadcast",
      event: "block-changed",
      payload: { type: "delete", blockId: id, senderTabId: myTabId }
    });
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
                      if (!confirm(`Delete "${nb.title}"? This cannot be undone.`)) return;
                      const isActive = nb.id === notebookId;
                      // Remove from sidebar immediately
                      setNotebooks((prev) => prev.filter((n) => n.id !== nb.id));
                      const { error } = await supabase.from("notebooks").delete().eq("id", nb.id);
                      if (error) {
                        toast.error("Failed to delete workspace");
                        // Reload list to restore on error
                        const { data } = await supabase.from("notebooks").select("*").order("last_updated", { ascending: false });
                        setNotebooks((data as any[]) || []);
                      } else {
                        toast.success("Workspace deleted");
                        // Only navigate away if user deleted the current workspace
                        if (isActive) navigate("/");
                      }
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

              {blocks.map((block) => {
                const typingUsers = activePresences.filter(
                  (ap) => ap.isTyping && ap.typingBlockId === block.id && !(ap.profile.id === user?.id && ap.tabId === myTabId)
                ).map((ap) => ap.profile);

                return (
                  <BlockEditor
                    key={block.id}
                    block={block}
                    userId={user!.id}
                    authorName={blockAuthors.get(block.user_id)?.display_name || "Unknown"}
                    authorInitials={blockAuthors.get(block.user_id)?.avatar_initials || "?"}
                    onUpdate={(updates) => updateBlock(block.id, updates)}
                    onDelete={() => deleteBlock(block.id)}
                    onVote={(optionId) => voteOnPoll(block.id, optionId)}
                    onTyping={handleTyping}
                    typingUsers={typingUsers}
                    isLocallyCreated={locallyCreatedBlockIdsRef.current.has(block.id)}
                  />
                );
              })}

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
// Markdown Renderer
// ============================================================================
function MarkdownRenderer({ content, fontSizeClass, bold, italic }: { content: string; fontSizeClass: string; bold?: boolean; italic?: boolean }) {
  if (!content?.trim()) {
    return <span className="text-slate-400 italic">Empty text block</span>;
  }

  const lines = content.split("\n");
  const parsedElements: React.ReactNode[] = [];
  
  let currentListItems: string[] = [];
  let inList = false;

  let currentTableRows: string[][] = [];
  let inTable = false;

  let currentCodeBlock: string[] = [];
  let inCodeBlock = false;

  const renderInline = (text: string) => {
    let parts: React.ReactNode[] = [text];
    
    // Bold: **text**
    parts = parts.flatMap(part => {
      if (typeof part !== "string") return part;
      const subparts = part.split(/\*\*([^*]+)\*\*/g);
      return subparts.map((sub, idx) => idx % 2 === 1 ? <strong key={`b-${idx}`} className="font-bold">{sub}</strong> : sub);
    });

    // Italic: *text*
    parts = parts.flatMap(part => {
      if (typeof part !== "string") return part;
      const subparts = part.split(/\*([^*]+)\*/g);
      return subparts.map((sub, idx) => idx % 2 === 1 ? <em key={`i-${idx}`} className="italic">{sub}</em> : sub);
    });

    // Inline Code: `code`
    parts = parts.flatMap(part => {
      if (typeof part !== "string") return part;
      const subparts = part.split(/`([^`]+)`/g);
      return subparts.map((sub, idx) => idx % 2 === 1 ? <code key={`c-${idx}`} className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono text-xs">{sub}</code> : sub);
    });

    return parts;
  };

  const flushList = (key: string) => {
    if (currentListItems.length > 0) {
      parsedElements.push(
        <ul key={`ul-${key}`} className="list-disc pl-5 my-1.5 space-y-0.5">
          {currentListItems.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      currentListItems = [];
      inList = false;
    }
  };

  const flushTable = (key: string) => {
    if (currentTableRows.length > 0) {
      const headers = currentTableRows[0];
      const rows = currentTableRows.slice(1).filter(row => !row.every(cell => cell.trim().startsWith("-")));
      parsedElements.push(
        <div key={`table-${key}`} className="my-3 overflow-x-auto border border-slate-200 rounded-lg shadow-2xs">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-700 font-bold">
              <tr>
                {headers.map((h, idx) => (
                  <th key={`th-${idx}`} className="px-3 py-2 text-left border-b border-slate-200">{renderInline(h.trim())}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100 text-slate-600">
              {rows.map((row, rIdx) => (
                <tr key={`tr-${rIdx}`} className="hover:bg-slate-50/50">
                  {row.map((cell, cIdx) => (
                    <td key={`td-${cIdx}`} className="px-3 py-2 border-r border-slate-100 last:border-r-0">{renderInline(cell.trim())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      currentTableRows = [];
      inTable = false;
    }
  };

  const flushCodeBlock = (key: string) => {
    if (currentCodeBlock.length > 0) {
      parsedElements.push(
        <pre key={`code-${key}`} className="bg-slate-800 text-slate-100 p-3 rounded-lg border font-mono text-xs my-2 overflow-x-auto">
          <code>{currentCodeBlock.join("\n")}</code>
        </pre>
      );
      currentCodeBlock = [];
      inCodeBlock = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock(String(i));
      } else {
        flushList(String(i));
        flushTable(String(i));
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      currentCodeBlock.push(line);
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      flushList(String(i));
      const cells = trimmed.split("|").slice(1, -1);
      currentTableRows.push(cells);
      inTable = true;
      continue;
    } else if (inTable) {
      flushTable(String(i));
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
      inList = true;
      currentListItems.push(trimmed.slice(2));
      continue;
    } else if (inList) {
      flushList(String(i));
    }

    if (trimmed.startsWith("# ")) {
      parsedElements.push(<h1 key={`h1-${i}`} className="text-xl font-bold text-slate-800 mt-2.5 mb-1.5 border-b pb-1">{renderInline(trimmed.slice(2))}</h1>);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      parsedElements.push(<h2 key={`h2-${i}`} className="text-lg font-bold text-slate-800 mt-2 mb-1">{renderInline(trimmed.slice(3))}</h2>);
      continue;
    }
    if (trimmed.startsWith("### ")) {
      parsedElements.push(<h3 key={`h3-${i}`} className="text-base font-bold text-slate-800 mt-1.5 mb-0.5">{renderInline(trimmed.slice(4))}</h3>);
      continue;
    }

    if (trimmed === "") {
      parsedElements.push(<div key={`empty-${i}`} className="h-2" />);
    } else {
      parsedElements.push(<p key={`p-${i}`} className="leading-relaxed my-0.5">{renderInline(line)}</p>);
    }
  }

  flushList("end");
  flushTable("end");
  flushCodeBlock("end");

  return (
    <div className={`${fontSizeClass} ${bold ? "font-bold" : ""} ${italic ? "italic" : ""} space-y-1`}>
      {parsedElements}
    </div>
  );
}

const getTypingIndicatorText = (users: Profile[]) => {
  if (users.length === 0) return "";
  if (users.length === 1) {
    return `${users[0].display_name} is typing...`;
  }
  if (users.length === 2) {
    return `${users[0].display_name} & ${users[1].display_name} are typing...`;
  }
  const firstNames = users.slice(0, -1).map(u => u.display_name).join(", ");
  return `${firstNames} & ${users[users.length - 1].display_name} are typing...`;
};

// ============================================================================
// Block Editor
// ============================================================================
function BlockEditor({
  block, userId, authorName, authorInitials, onUpdate, onDelete, onVote, onTyping, typingUsers, isLocallyCreated,
}: {
  block: NoteBlock;
  userId: string;
  authorName: string;
  authorInitials: string;
  onUpdate: (updates: Partial<NoteBlock>) => void;
  onDelete: () => void;
  onVote: (optionId: string) => void;
  onTyping: (blockId: string | null) => void;
  typingUsers?: Profile[];
  isLocallyCreated?: boolean;
}) {
  const isOwner = block.user_id === userId;
  const [isEditing, setIsEditing] = useState(() => {
    if (!isOwner) return false;
    if (isLocallyCreated) {
      if (block.type === "text" && !block.content?.trim()) return true;
      if (block.type === "bullets" && !block.content?.trim()) return true;
      if (block.type === "table") {
        const table = block.table_data;
        return !table || table.rows.every(r => r.every(c => !c.trim()));
      }
      if (block.type === "poll") {
        const poll = block.poll_data;
        return !poll || (!poll.question.trim() && poll.options.every(o => !o.text.trim()));
      }
    }
    return false;
  });
  const [expanded, setExpanded] = useState(false);
  const fontSizeClass = FONT_SIZES[block.font_size] || "text-base";
  const highlightWrap = getHighlightWrapClass(block.highlight_color);

  // Local caching states for WhatsApp-style sync
  const [localContent, setLocalContent] = useState(block.content || "");
  const [localTableData, setLocalTableData] = useState(block.table_data);
  const [localPollData, setLocalPollData] = useState(block.poll_data);

  useEffect(() => {
    if (!isEditing) {
      setLocalContent(block.content || "");
      setLocalTableData(block.table_data);
      setLocalPollData(block.poll_data);
    }
  }, [block.content, block.table_data, block.poll_data, isEditing]);

  // Prevent empty text blocks from rendering for non-owners — UNLESS someone is actively typing in it
  if (block.type === "text" && !block.content?.trim() && !isOwner && (!typingUsers || typingUsers.length === 0)) {
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
                onClick={() => {
                  setIsEditing(false);
                  onTyping(null);
                  if (block.type === "text" && localContent !== block.content) {
                    onUpdate({ content: localContent });
                  }
                }}
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
            content={localContent}
            bulletStyle={block.bullet_style || "dot"}
            readOnly={!isOwner}
            onChange={(content) => {
              setLocalContent(content);
              onTyping(block.id);
            }}
            onEditEnter={() => {
              setIsEditing(true);
              onTyping(block.id);
            }}
            onDelete={onDelete}
            isEditing={isEditing}
            setIsEditing={(val) => {
              setIsEditing(val);
              if (!val) {
                onTyping(null);
                onUpdate({ content: localContent });
              }
            }}
          />
        ) : !isEditing ? (
          <div
            onClick={() => {
              if (isOwner) {
                setIsEditing(true);
                onTyping(block.id);
              }
            }}
            className={`w-full ${!isOwner ? "cursor-default" : "cursor-pointer"}`}
          >
            {(() => {
              const lines = (localContent || "").split("\n");
              const hasMoreThan10Lines = lines.length > 10;
              const displayedContent = (hasMoreThan10Lines && !expanded)
                ? lines.slice(0, 10).join("\n")
                : localContent;
              return (
                <>
                  <MarkdownRenderer
                    content={displayedContent}
                    fontSizeClass={fontSizeClass}
                    bold={block.bold}
                    italic={block.italic}
                  />
                  {hasMoreThan10Lines && (
                    <div className="mt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded(!expanded);
                        }}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700 transition cursor-pointer"
                      >
                        {expanded ? "Read Less" : "... Read More"}
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        ) : (
          <textarea
            autoFocus={isOwner && !block.content}
            value={localContent}
            onChange={(e) => {
              setLocalContent(e.target.value);
              onTyping(block.id);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              const lines = text.split("\n");
              const isMarkdownList = lines.some(line => {
                const trimmed = line.trim();
                return trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ") || /^\d+\.\s/.test(trimmed);
              });
              if (isMarkdownList) {
                e.preventDefault();
                const parsedContent = lines
                  .map((line) => line.replace(/^(\s*[-*•]|\s*\d+\.)\s*/, ""))
                  .filter((line) => line.trim() !== "")
                  .join("\n");
                setIsEditing(false);
                onTyping(null);
                onUpdate({
                  type: "bullets",
                  content: parsedContent,
                });
              }
            }}
            onFocus={() => {
              if (isOwner) {
                setIsEditing(true);
                onTyping(block.id);
              }
            }}
            onBlur={(e) => {
              setIsEditing(false);
              onTyping(null);
              if (isOwner && !e.target.value.trim()) {
                onDelete();
              } else if (isOwner && e.target.value !== block.content) {
                onUpdate({ content: e.target.value });
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
              onClick={() => {
                setIsEditing(true);
                onTyping(block.id);
              }}
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

        {typingUsers && typingUsers.length > 0 && (
          <div className="text-[10px] text-blue-600 font-semibold font-sans flex items-center gap-1 mt-1.5 select-none animate-pulse">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping mr-1"></span>
            <span className="italic">{getTypingIndicatorText(typingUsers)}</span>
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
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => {
                  if (isEditing) {
                    const isEmpty = localTableData.rows.every(r => r.every(c => !c.trim()));
                    if (isEmpty) {
                      onDelete();
                      onTyping(null);
                      return;
                    }
                    onUpdate({ table_data: localTableData });
                  }
                  setIsEditing(!isEditing);
                  if (isEditing) {
                    onTyping(null);
                  } else {
                    onTyping(block.id);
                  }
                }}
                className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider transition ${
                  isEditing
                    ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                    : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200"
                }`}
              >
                {isEditing ? "Done" : "Edit"}
              </button>
              <button
                onClick={() => {
                  onDelete();
                  onTyping(null);
                }}
                className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b-2 border-slate-200">
                {localTableData.headers.map((header, i) => (
                  <th key={i} className="px-3 py-2 text-left border-r border-slate-200 last:border-r-0">
                    {isEditing && isOwner ? (
                      <input
                        value={header}
                        onChange={(e) => {
                          const headers = [...localTableData.headers];
                          headers[i] = e.target.value;
                          setLocalTableData({ ...localTableData, headers });
                          onTyping(block.id);
                        }}
                        onFocus={() => onTyping(block.id)}
                        onBlur={() => onTyping(null)}
                        className="w-full bg-transparent border-none focus:outline-none focus:border-blue-500 text-xs font-bold text-slate-700 uppercase tracking-wider font-mono"
                      />
                    ) : (
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider font-mono block min-h-[16px]">
                        {header || `Column ${i + 1}`}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {localTableData.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-slate-200 last:border-b-0 hover:bg-slate-50/50">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 border-r border-slate-200 last:border-r-0">
                      {isEditing && isOwner ? (
                        <input
                          value={cell}
                          onChange={(e) => {
                            const rows = localTableData.rows.map((r) => [...r]);
                            rows[ri][ci] = e.target.value;
                            setLocalTableData({ ...localTableData, rows });
                            onTyping(block.id);
                          }}
                          onFocus={() => onTyping(block.id)}
                          onBlur={() => onTyping(null)}
                          className="w-full bg-transparent border-none focus:outline-none focus:text-blue-600 text-sm text-slate-700"
                        />
                      ) : (
                        <span className="text-sm text-slate-700 block min-h-[20px]">
                          {cell || <span className="text-slate-300 italic text-xs">Empty</span>}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isEditing && isOwner && (
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => {
                const newTable: TableData = {
                  ...localTableData,
                  rows: [...localTableData.rows, localTableData.headers.map(() => "")],
                };
                setLocalTableData(newTable);
                onTyping(block.id);
              }}
              className="text-[10px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md px-2 py-1 transition cursor-pointer"
            >
              + Add Row
            </button>
            <button
              onClick={() => {
                const newTable: TableData = {
                  ...localTableData,
                  headers: [...localTableData.headers, `Column ${localTableData.headers.length + 1}`],
                  rows: localTableData.rows.map((r) => [...r, ""]),
                };
                setLocalTableData(newTable);
                onTyping(block.id);
              }}
              className="text-[10px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md px-2 py-1 transition cursor-pointer"
            >
              + Add Column
            </button>
          </div>
        )}
        {typingUsers && typingUsers.length > 0 && (
          <div className="text-[10px] text-blue-600 font-semibold font-sans flex items-center gap-1 mt-1.5 select-none animate-pulse">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping mr-1"></span>
            <span className="italic">{getTypingIndicatorText(typingUsers)}</span>
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
        onTyping={onTyping}
        typingUsers={typingUsers}
        blockId={block.id}
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
              onClick={() => {
                const isEmpty = localLines.every(line => !line.trim());
                if (isEmpty) {
                  onDelete();
                } else {
                  setIsEditing(false);
                }
              }}
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
  poll, isOwner, userId, onUpdate, onDelete, onVote, onTyping, typingUsers, blockId,
}: {
  poll: PollData;
  isOwner: boolean;
  userId: string;
  onUpdate: (updates: Partial<NoteBlock>) => void;
  onDelete: () => void;
  onVote: (optionId: string) => void;
  onTyping: (blockId: string | null) => void;
  typingUsers?: Profile[];
  blockId: string;
}) {
  const [isEditing, setIsEditing] = useState(() => {
    if (!isOwner) return false;
    return !poll.question.trim();
  });
  const [localPoll, setLocalPoll] = useState(poll);

  useEffect(() => {
    if (!isEditing) {
      setLocalPoll(poll);
    }
  }, [poll, isEditing]);

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
              onClick={() => {
                if (isEditing) {
                  const isQuestionEmpty = !localPoll.question.trim();
                  const areOptionsEmpty = localPoll.options.every(o => !o.text.trim() || o.text === "Option 1" || o.text === "Option 2");
                  if (isQuestionEmpty && areOptionsEmpty) {
                    onDelete();
                    onTyping(null);
                    return;
                  }
                  onUpdate({ poll_data: localPoll });
                }
                setIsEditing(!isEditing);
                if (isEditing) {
                  onTyping(null);
                } else {
                  onTyping(blockId);
                }
              }}
              className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider transition ${
                isEditing
                  ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                  : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200"
              }`}
            >
              {isEditing ? "Done" : "Edit"}
            </button>
            <button
              onClick={() => {
                onDelete();
                onTyping(null);
              }}
              className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {isEditing && isOwner ? (
        <input
          value={localPoll.question}
          onChange={(e) => {
            setLocalPoll({ ...localPoll, question: e.target.value });
            onTyping(blockId);
          }}
          onFocus={() => onTyping(blockId)}
          onBlur={() => onTyping(null)}
          placeholder="Poll question..."
          className="w-full bg-transparent border-b border-blue-400 focus:outline-none text-base font-bold text-slate-800 mb-3"
        />
      ) : (
        <p className="text-base font-bold text-slate-800 mb-3">
          {poll.question || "Untitled poll"}
        </p>
      )}

      <div className="space-y-2">
        {localPoll.options.map((opt, idx) => {
          const pct = totalVotes > 0 ? (opt.votes / totalVotes) * 100 : 0;
          return (
            <div key={opt.id} className="space-y-1">
              {isEditing && isOwner ? (
                <div className="flex items-center gap-2">
                  <input
                    value={opt.text}
                    onChange={(e) => {
                      const updated: PollData = {
                        ...localPoll,
                        options: localPoll.options.map((o) =>
                          o.id === opt.id ? { ...o, text: e.target.value } : o
                        ),
                      };
                      setLocalPoll(updated);
                      onTyping(blockId);
                    }}
                    onFocus={() => onTyping(blockId)}
                    onBlur={() => onTyping(null)}
                    placeholder={`Option ${idx + 1} text...`}
                    className="flex-1 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                  />
                  <button
                    onClick={() => {
                      const updated: PollData = {
                        ...localPoll,
                        options: localPoll.options.filter((o) => o.id !== opt.id),
                      };
                      setLocalPoll(updated);
                      onTyping(blockId);
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
                ...localPoll,
                options: [...localPoll.options, { id: crypto.randomUUID(), text: "", votes: 0 }],
              };
              setLocalPoll(updated);
              onTyping(blockId);
            }}
            className="text-[10px] font-mono text-blue-600 hover:text-blue-700 transition flex items-center gap-1 cursor-pointer"
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
      {typingUsers && typingUsers.length > 0 && (
        <div className="text-[10px] text-blue-600 font-semibold font-sans flex items-center gap-1 mt-1.5 select-none animate-pulse">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping mr-1"></span>
          <span className="italic">{getTypingIndicatorText(typingUsers)}</span>
        </div>
      )}
    </div>
  );
}

