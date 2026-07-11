import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import {
  ArrowLeft, Plus, Trash2, Send, Check, MessageSquare,
  Activity, Mail, Loader2,
  AlignLeft, List, Table2, BarChart2, Download,
  Share2, Volume2, VolumeX, Bot
} from "lucide-react";
import { toast } from "sonner";
import { speakText, stopSpeaking, isSpeechSynthesisAvailable } from "@/utils/speechUtils";
import ShareModal from "@/components/share-modal";
import JarvisPanel from "@/components/jarvis-panel";
import type { Notebook, NoteBlock, Collaborator, Profile, PollData, JarvisInsight } from "@/lib/types";

// ============================================================================
// Colour helpers
// ============================================================================
const COLLAB_COLORS = ["bg-indigo-600", "bg-emerald-600", "bg-blue-600", "bg-amber-600", "bg-slate-600"];
function getColorForName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLLAB_COLORS[Math.abs(hash) % COLLAB_COLORS.length];
}

// ============================================================================
// Main page
// ============================================================================
export default function NotebookPage() {
  const { notebookId } = useParams<{ notebookId: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [blocks, setBlocks] = useState<NoteBlock[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [ownerProfile, setOwnerProfile] = useState<Profile | null>(null);
  const [activeUsers, setActiveUsers] = useState<{ id: string }[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [insight, setInsight] = useState<JarvisInsight | null>(null);
  const [showJarvis, setShowJarvis] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Co-Founder");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const activeNotebookId = notebookId;
  const presenceChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Load sidebar notebooks
  useEffect(() => {
    if (!user) return;
    supabase
      .from("notebooks")
      .select("*")
      .order("last_updated", { ascending: false })
      .then(({ data }) => setNotebooks((data as Notebook[]) || []));
  }, [user]);

  // Load notebook + blocks + collaborators
  useEffect(() => {
    if (!notebookId || !user) return;
    setLoading(true);

    async function load() {
      const [nbRes, colRes] = await Promise.all([
        supabase.from("notebooks").select("*").eq("id", notebookId!).maybeSingle(),
        supabase.from("notebook_collaborators").select("*, profile:profiles(*)").eq("notebook_id", notebookId!),
      ]);

      if (nbRes.data) {
        const nb = nbRes.data as Notebook;
        setNotebook(nb);
        setIsOwner(nb.user_id === user!.id);

        // Load owner profile
        const { data: op } = await supabase.from("profiles").select("*").eq("id", nb.user_id).maybeSingle();
        setOwnerProfile((op as Profile) || null);
      }

      if (colRes.data) setCollaborators(colRes.data as Collaborator[]);

      // Load blocks
      const { data: bData } = await supabase
        .from("note_blocks")
        .select("*")
        .eq("notebook_id", notebookId!)
        .order("position", { ascending: true });
      setBlocks((bData as NoteBlock[]) || []);
      setLoading(false);
    }

    load();
  }, [notebookId, user]);

  // Realtime
  useEffect(() => {
    if (!notebookId) return;

    const channel = supabase
      .channel(`notebook:${notebookId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "note_blocks", filter: `notebook_id=eq.${notebookId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setBlocks((prev) => {
              if (prev.find((b) => b.id === (payload.new as NoteBlock).id)) return prev;
              return [...prev, payload.new as NoteBlock].sort((a, b) => a.position - b.position);
            });
          } else if (payload.eventType === "UPDATE") {
            setBlocks((prev) => prev.map((b) => b.id === (payload.new as NoteBlock).id ? payload.new as NoteBlock : b));
          } else if (payload.eventType === "DELETE") {
            setBlocks((prev) => prev.filter((b) => b.id !== (payload.old as NoteBlock).id));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [notebookId]);

  // Presence
  useEffect(() => {
    if (!notebookId || !user || !profile) return;

    const ch = supabase.channel(`presence:${notebookId}`, { config: { presence: { key: user.id } } });
    presenceChannel.current = ch;

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState();
      const users = Object.values(state).flat().map((u: any) => ({ id: u.user_id }));
      setActiveUsers(users);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ user_id: user.id, display_name: profile.display_name });
      }
    });

    return () => { supabase.removeChannel(ch); };
  }, [notebookId, user, profile]);

  async function addBlock(type: NoteBlock["type"]) {
    if (!notebookId || !user) return;
    const position = blocks.length;
    const newBlock: Partial<NoteBlock> = {
      notebook_id: notebookId,
      type,
      content: "",
      position,
      user_id: user.id,
      ...(type === "poll" ? { poll_data: { question: "New Poll", options: [
        { id: crypto.randomUUID(), text: "Option 1", votes: 0 },
        { id: crypto.randomUUID(), text: "Option 2", votes: 0 },
      ], voted_user_ids: [] } } : {}),
    };
    const { data, error } = await supabase.from("note_blocks").insert(newBlock).select().maybeSingle();
    if (error) { toast.error("Failed to add block"); return; }
    setBlocks((prev) => [...prev, data as NoteBlock]);
  }

  const updateBlock = useCallback(async (id: string, updates: Partial<NoteBlock>) => {
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, ...updates } : b));
    setIsSaving(true);
    const { error } = await supabase.from("note_blocks").update(updates).eq("id", id);
    setIsSaving(false);
    if (error) toast.error("Save failed");
  }, []);

  const deleteBlock = useCallback(async (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    await supabase.from("note_blocks").delete().eq("id", id);
  }, []);

  async function voteOnPoll(blockId: string, optionId: string) {
    const block = blocks.find((b) => b.id === blockId);
    if (!block?.poll_data || !user) return;
    const poll = block.poll_data;
    if (poll.voted_user_ids.includes(user.id)) { toast.error("Already voted"); return; }
    const updated: PollData = {
      ...poll,
      options: poll.options.map((o) => o.id === optionId ? { ...o, votes: o.votes + 1 } : o),
      voted_user_ids: [...poll.voted_user_ids, user.id],
    };
    await updateBlock(blockId, { poll_data: updated });
  }

  async function inviteCollaborator() {
    if (!inviteEmail.trim()) { setInviteError("Email is required"); return; }
    setIsInviting(true); setInviteError(""); setInviteSuccess(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-collaborator`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ notebookId, email: inviteEmail.trim(), role: inviteRole }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Invite failed");
      setInviteSuccess(true); setInviteEmail(""); setInviteRole("Co-Founder");
      const { data: colRes } = await supabase.from("notebook_collaborators").select("*, profile:profiles(*)").eq("notebook_id", notebookId!);
      if (colRes) setCollaborators(colRes as Collaborator[]);
      setTimeout(() => { setInviteSuccess(false); setShowInviteForm(false); }, 2500);
    } catch (err: any) {
      setInviteError(err.message || "Invite failed");
    } finally {
      setIsInviting(false);
    }
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

  async function exportPDF() {
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const el = document.getElementById("notebook-content");
      if (!el) return;
      const canvas = await html2canvas(el, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = (canvas.height * pdfW) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, pdfW, pdfH);
      pdf.save(`${notebook?.title || "notebook"}.pdf`);
      toast.success("PDF exported");
    } catch {
      toast.error("PDF export failed");
    }
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!notebook) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-2">
          <p className="font-bold text-slate-800">Workspace not found</p>
          <button onClick={() => navigate("/")} className="text-xs text-blue-600 underline">Back to dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#F4F6F9] flex font-sans select-none overflow-hidden">
      {/* ============================================================ */}
      {/* LEFT SIDEBAR — premium black */}
      {/* ============================================================ */}
      <aside className="w-72 bg-slate-950 flex flex-col h-full border-r border-slate-800 shrink-0">

        {/* Back to Dashboard */}
        <div className="px-4 pt-4 pb-2 border-b border-slate-800">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 hover:text-white uppercase tracking-wider font-bold transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
          </button>
        </div>

        {/* Branding */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-white flex items-center justify-center font-black font-sans text-slate-950 text-xs shadow-premium">
              S
            </div>
            <div>
              <p className="font-sans font-bold text-xs tracking-tight text-white leading-none">Sage Workspace</p>
              <p className="text-[9px] uppercase tracking-widest font-mono text-slate-500 mt-1">Co-Founder Sync</p>
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
            className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-slate-300" />
          </button>
        </div>

        {/* Notebook List */}
        <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1.5 scrollbar-thin">
          <p className="text-[10px] font-mono text-slate-600 uppercase tracking-wider font-semibold px-2 mb-1">
            Brainstorm Boards ({notebooks.length})
          </p>
          {notebooks.map((nb) => {
            const active = nb.id === activeNotebookId;
            return (
              <div
                key={nb.id}
                onClick={() => navigate(`/notebook/${nb.id}`)}
                className={`group flex items-center justify-between px-3 py-2.5 cursor-pointer transition-all rounded-xl ${
                  active
                    ? "bg-white/10 text-white border border-white/20 border-l-2 border-l-slate-300 font-semibold"
                    : "border border-transparent hover:bg-slate-800/70 text-slate-400 hover:text-slate-200"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${active ? "text-slate-200" : "text-slate-600"}`} />
                  <span className="text-2xs truncate">{nb.title}</span>
                </div>
                {nb.user_id === user?.id && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Delete "${nb.title}"? This cannot be undone.`)) return;
                      const isActive = nb.id === notebookId;
                      setNotebooks((prev) => prev.filter((n) => n.id !== nb.id));
                      const { error } = await supabase.from("notebooks").delete().eq("id", nb.id);
                      if (error) {
                        toast.error("Failed to delete workspace");
                        const { data } = await supabase.from("notebooks").select("*").order("last_updated", { ascending: false });
                        setNotebooks((data as any[]) || []);
                      } else {
                        toast.success("Workspace deleted");
                        if (isActive) navigate("/");
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-rose-400 transition ml-1 shrink-0 text-slate-600"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
          {notebooks.length === 0 && (
            <p className="text-3xs text-slate-600 font-mono px-3 py-4 text-center">No workspaces yet.</p>
          )}
        </div>

        {/* Collaborators Footer */}
        <div className="p-4 border-t border-slate-800 space-y-3.5">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-bold">
            <Activity className="w-3 h-3 text-emerald-400 animate-pulse" />
            Active Online ({collaborators.length + 1})
          </div>

          <button
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="text-[10px] font-bold uppercase font-mono text-slate-400 hover:text-white transition flex items-center gap-1"
          >
            <Mail className="w-3 h-3" /> {showInviteForm ? "Cancel Invite" : "+ Invite Collaborator"}
          </button>

          {showInviteForm && (
            <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-700 space-y-2.5">
              {inviteError && (
                <div className="bg-rose-950/50 border border-rose-800 text-rose-300 rounded text-[9px] font-mono p-2">
                  ⚠️ {inviteError}
                </div>
              )}
              {inviteSuccess && (
                <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-300 rounded text-[9px] font-mono p-2">
                  ✅ Invitation sent!
                </div>
              )}
              <div>
                <label className="block text-[9px] font-mono uppercase text-slate-500 font-semibold mb-1">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="partner@example.com"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-500"
                />
              </div>
              <div>
                <label className="block text-[9px] font-mono uppercase text-slate-500 font-semibold mb-1">Role</label>
                <input
                  type="text"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  placeholder="Co-Founder"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-500"
                />
              </div>
              <button
                onClick={inviteCollaborator}
                disabled={isInviting}
                className="w-full bg-white hover:bg-slate-100 text-slate-950 py-1.5 rounded-lg font-bold font-mono text-[9px] uppercase tracking-wider transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                {isInviting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                {isInviting ? "Sending..." : "Send Invite"}
              </button>
            </div>
          )}

          {/* Owner */}
          <div className="flex items-center justify-between p-2 rounded-xl border border-slate-800 bg-slate-900">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative shrink-0">
                <div className="w-7 h-7 rounded-full bg-white text-slate-950 flex items-center justify-center text-2xs font-bold font-sans">
                  {ownerProfile?.avatar_initials || "?"}
                </div>
                {activeUsers.find(u => u.id === ownerProfile?.id) && (
                  <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-slate-950 shadow-sm" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-2xs font-bold text-slate-200 truncate">{ownerProfile?.display_name || "Owner"}</p>
                <p className="text-[9px] text-slate-500 font-mono">Owner</p>
              </div>
            </div>
            {profile?.id === ownerProfile?.id && (
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest shrink-0 ml-2 bg-slate-800 px-1.5 py-0.5 rounded">You</span>
            )}
          </div>

          {/* Collaborators */}
          {collaborators.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="relative shrink-0">
                  <div className={`w-7 h-7 rounded-full ${getColorForName(c.profile?.display_name || "?")} text-white flex items-center justify-center text-2xs font-bold font-sans`}>
                    {c.profile?.avatar_initials || "?"}
                  </div>
                  {activeUsers.find(u => u.id === c.user_id) && (
                    <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-slate-950 shadow-sm" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-2xs font-bold text-slate-200 truncate">{c.profile?.display_name || "Unknown"}</p>
                  <p className="text-[9px] text-slate-500 font-mono">{c.role}</p>
                </div>
              </div>
              {profile?.id === c.user_id && (
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest shrink-0 ml-2 bg-slate-800 px-1.5 py-0.5 rounded">You</span>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden relative">
          {/* Editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top Bar */}
            <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between shrink-0 shadow-2xs">
              <div className="flex items-center gap-3 min-w-0">
                <input
                  value={notebook?.title || ""}
                  readOnly={!isOwner}
                  onChange={async (e) => {
                    if (!notebook) return;
                    const newTitle = e.target.value;
                    setNotebook({ ...notebook, title: newTitle });
                    await supabase.from("notebooks").update({ title: newTitle }).eq("id", notebook.id);
                  }}
                  className="text-lg font-bold font-sans w-80 md:w-96 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none transition"
                />
                {isSaving && <span className="text-[10px] font-mono text-slate-400 animate-pulse">saving…</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Add block buttons */}
                <div className="flex items-center gap-1.5 border-r border-slate-200 pr-3 mr-1">
                  {([
                    { type: "text", icon: <AlignLeft className="w-3.5 h-3.5" />, label: "Text" },
                    { type: "bullets", icon: <List className="w-3.5 h-3.5" />, label: "Bullets" },
                    { type: "table", icon: <Table2 className="w-3.5 h-3.5" />, label: "Table" },
                    { type: "poll", icon: <BarChart2 className="w-3.5 h-3.5" />, label: "Poll" },
                  ] as { type: NoteBlock["type"]; icon: React.ReactNode; label: string }[]).map(({ type, icon, label }) => (
                    <button
                      key={type}
                      onClick={() => addBlock(type)}
                      title={`Add ${label} block`}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-mono font-bold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition uppercase tracking-wide cursor-pointer"
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>

                {/* Voice */}
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
                  title={isSpeaking ? "Stop speaking" : "Read notes aloud"}
                  className={`p-2 rounded-lg border transition cursor-pointer ${
                    isSpeaking
                      ? "bg-blue-50 border-blue-300 text-blue-600"
                      : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {isSpeaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>

                {/* Jarvis */}
                <button
                  onClick={() => setShowJarvis(!showJarvis)}
                  title="Jarvis AI"
                  className={`p-2 rounded-lg border transition cursor-pointer ${
                    showJarvis
                      ? "bg-violet-50 border-violet-300 text-violet-600"
                      : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <Bot className="w-3.5 h-3.5" />
                </button>

                {/* Export */}
                <div className="relative">
                  <button
                    onClick={() => setExportMenuOpen(!exportMenuOpen)}
                    title="Export"
                    className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 hover:bg-slate-100 transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  {exportMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 bg-white rounded-xl border border-slate-200 shadow-premium p-2 w-80 z-20">
                      <button
                        onClick={() => { exportPDF(); setExportMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 rounded-lg transition font-semibold"
                      >
                        Export as PDF
                      </button>
                    </div>
                  )}
                </div>

                {/* Share */}
                <button
                  onClick={() => setShowShareModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-mono font-bold rounded-lg transition cursor-pointer shadow-premium"
                >
                  <Share2 className="w-3 h-3" /> Share
                </button>
              </div>
            </div>

            {/* Blocks */}
            <div id="notebook-content" className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
              {blocks.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                    <AlignLeft className="w-5 h-5 text-slate-400" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-slate-700">No blocks yet</p>
                    <p className="text-xs text-slate-400 mt-1">Add a Text, Bullet, Table, or Poll block from the toolbar above</p>
                  </div>
                </div>
              )}
              {blocks.map((block) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  isOwner={isOwner || block.user_id === user?.id}
                  userId={user?.id || ""}
                  onUpdate={(updates) => updateBlock(block.id, updates)}
                  onDelete={() => deleteBlock(block.id)}
                  onVote={(optionId) => voteOnPoll(block.id, optionId)}
                  onSpeak={handleSpeak}
                />
              ))}
            </div>
          </div>

          {/* Jarvis Panel */}
          {showJarvis && (
            <JarvisPanel
              isOpen={showJarvis}
              onToggle={() => setShowJarvis(!showJarvis)}
              notebookId={notebookId!}
              blocks={blocks}
              insight={insight}
              onInsightUpdate={setInsight}
              onSpeak={handleSpeak}
              isSpeaking={isSpeaking}
              onStopSpeaking={() => setIsSpeaking(false)}
            />
          )}
        </div>
      </div>

      {/* Share Modal */}
      {showShareModal && (
        <ShareModal
          notebook={notebook}
          blocks={blocks}
          insight={insight}
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          onSpeak={handleSpeak}
          isSpeaking={isSpeaking}
        />
      )}
    </div>
  );
}

// ============================================================================
// BlockEditor
// ============================================================================
function BlockEditor({
  block, isOwner, userId, onUpdate, onDelete, onVote, onSpeak,
}: {
  block: NoteBlock;
  isOwner: boolean;
  userId: string;
  onUpdate: (updates: Partial<NoteBlock>) => void;
  onDelete: () => void;
  onVote: (optionId: string) => void;
  onSpeak: (text: string) => void;
}) {
  if (block.type === "text") {
    return (
      <TextBlock
        block={block}
        isOwner={isOwner}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onSpeak={onSpeak}
      />
    );
  }

  if (block.type === "bullets") {
    return (
      <BulletEditor
        block={block}
        isOwner={isOwner}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    );
  }

  if (block.type === "table") {
    return (
      <TableBlock
        block={block}
        isOwner={isOwner}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    );
  }

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
// TextBlock
// ============================================================================
function TextBlock({
  block, isOwner, onUpdate, onDelete, onSpeak,
}: {
  block: NoteBlock;
  isOwner: boolean;
  onUpdate: (updates: Partial<NoteBlock>) => void;
  onDelete: () => void;
  onSpeak: (text: string) => void;
}) {
  return (
    <div className="group border border-slate-200 bg-white transition-all duration-200 py-3 relative px-4 rounded-xl hover:shadow-premium">
      <div className="flex items-center gap-2 mb-2 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-bold">
        <AlignLeft className="w-3.5 h-3.5 text-slate-400" /> Text Block
        {!isOwner && <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded normal-case tracking-normal">Read-only</span>}
        {isOwner && (
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => onSpeak(block.content)}
              className="p-1.5 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-slate-600 transition"
              title="Read aloud"
            >
              <Volume2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      <textarea
        value={block.content}
        readOnly={!isOwner}
        onChange={(e) => onUpdate({ content: e.target.value })}
        placeholder="Write your notes here..."
        rows={4}
        className={`w-full bg-transparent resize-none text-sm text-slate-800 leading-relaxed focus:outline-none ${!isOwner ? "cursor-default" : ""}`}
      />
    </div>
  );
}

// ============================================================================
// BulletEditor
// ============================================================================
type BulletLine = { id: string; text: string; indent: number; style: "bullet" | "number" | "check" | "arrow" };

function parseBullets(raw: string): BulletLine[] {
  if (!raw.trim()) return [{ id: crypto.randomUUID(), text: "", indent: 0, style: "bullet" }];
  return raw.split("\n").map((line) => {
    const m = line.match(/^(\s*)([-•→☐]|\d+\.) (.*)$/);
    if (!m) return { id: crypto.randomUUID(), text: line, indent: 0, style: "bullet" as const };
    const indentSpaces = m[1].length;
    const marker = m[2];
    const text = m[3];
    let style: BulletLine["style"] = "bullet";
    if (marker === "→") style = "arrow";
    else if (marker === "☐") style = "check";
    else if (/^\d+\.$/.test(marker)) style = "number";
    return { id: crypto.randomUUID(), text, indent: Math.floor(indentSpaces / 2), style };
  });
}

function serializeBullets(lines: BulletLine[]): string {
  return lines.map((l) => {
    const pad = "  ".repeat(l.indent);
    let marker = "•";
    if (l.style === "arrow") marker = "→";
    else if (l.style === "check") marker = "☐";
    return `${pad}${marker} ${l.text}`;
  }).join("\n");
}

function BulletEditor({
  block, isOwner, onUpdate, onDelete,
}: {
  block: NoteBlock;
  isOwner: boolean;
  onUpdate: (updates: Partial<NoteBlock>) => void;
  onDelete: () => void;
}) {
  const [lines, setLines] = useState<BulletLine[]>(() => parseBullets(block.content));
  const [isEditing, setIsEditing] = useState(false);

  function save(updated: BulletLine[]) {
    setLines(updated);
    onUpdate({ content: serializeBullets(updated) });
  }

  function addLine() {
    const updated = [...lines, { id: crypto.randomUUID(), text: "", indent: 0, style: "bullet" as const }];
    save(updated);
  }

  const STYLES: BulletLine["style"][] = ["bullet", "arrow", "check"];
  const STYLE_CHARS = { bullet: "•", arrow: "→", check: "☐", number: "1." };

  return (
    <div
      className="group border border-slate-200 bg-white transition-all duration-200 py-3 relative px-4 rounded-xl hover:shadow-premium"
      onClick={() => { if (isOwner && !isEditing) setIsEditing(true); }}
    >
      <div className="flex items-center gap-2 mb-2 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-bold">
        <List className="w-3.5 h-3.5 text-slate-400" /> Bullets Block
        {!isOwner && <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded normal-case tracking-normal">Read-only</span>}
      </div>

      {lines.map((line, i) => (
        <div key={line.id} className="flex items-start gap-2 py-0.5" style={{ paddingLeft: `${line.indent * 16}px` }}>
          {isEditing && isOwner ? (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const idx = STYLES.indexOf(line.style);
                  const updated = lines.map((l, li) => li === i ? { ...l, style: STYLES[(idx + 1) % STYLES.length] } : l);
                  save(updated);
                }}
                className="mt-0.5 text-[10px] w-4 text-slate-400 hover:text-slate-700 transition shrink-0 font-mono"
                title="Cycle style"
              >
                {STYLE_CHARS[line.style]}
              </button>
              <input
                autoFocus={i === lines.length - 1}
                value={line.text}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => save(lines.map((l, li) => li === i ? { ...l, text: e.target.value } : l))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); const newLine = { id: crypto.randomUUID(), text: "", indent: line.indent, style: line.style }; save([...lines.slice(0, i + 1), newLine, ...lines.slice(i + 1)]); }
                  if (e.key === "Backspace" && line.text === "" && lines.length > 1) { e.preventDefault(); save(lines.filter((_, li) => li !== i)); }
                  if (e.key === "Tab") { e.preventDefault(); if (e.shiftKey) save(lines.map((l, li) => li === i ? { ...l, indent: Math.max(0, l.indent - 1) } : l)); else save(lines.map((l, li) => li === i ? { ...l, indent: Math.min(4, l.indent + 1) } : l)); }
                }}
                className="flex-1 text-sm bg-transparent border-b border-slate-200 focus:border-blue-400 focus:outline-none py-0.5 text-slate-800"
              />
              <button
                onClick={(e) => { e.stopPropagation(); if (lines.length > 1) save(lines.filter((_, li) => li !== i)); }}
                className="mt-0.5 p-0.5 hover:text-rose-500 text-slate-300 transition"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          ) : (
            <p className="text-sm text-slate-800 flex items-start gap-1.5">
              <span className="text-slate-400 font-mono text-[10px] mt-0.5">{STYLE_CHARS[line.style]}</span>
              {line.text || <span className="text-slate-300 italic">Empty</span>}
            </p>
          )}
        </div>
      ))}

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
// TableBlock
// ============================================================================
function TableBlock({
  block, isOwner, onUpdate, onDelete,
}: {
  block: NoteBlock;
  isOwner: boolean;
  onUpdate: (updates: Partial<NoteBlock>) => void;
  onDelete: () => void;
}) {
  type TableData = { headers: string[]; rows: string[][] };
  const parseTable = (raw: string): TableData => {
    try { return JSON.parse(raw); } catch { return { headers: ["Column 1", "Column 2"], rows: [["", ""]] }; }
  };
  const [data, setData] = useState<TableData>(() => parseTable(block.content));

  function save(updated: TableData) {
    setData(updated);
    onUpdate({ content: JSON.stringify(updated) });
  }

  return (
    <div className="group border border-slate-200 bg-white transition-all duration-200 py-3 relative px-4 rounded-xl hover:shadow-premium overflow-x-auto">
      <div className="flex items-center gap-2 mb-3 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-bold">
        <Table2 className="w-3.5 h-3.5 text-slate-400" /> Table Block
        {!isOwner && <span className="text-[9px] bg-slate-100 px-1.5 py-0.5 rounded normal-case tracking-normal">Read-only</span>}
        {isOwner && (
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => save({ ...data, headers: [...data.headers, `Column ${data.headers.length + 1}`], rows: data.rows.map(r => [...r, ""]) })}
              className="text-[9px] font-mono text-blue-600 hover:text-blue-700 transition flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" /> Col
            </button>
            <button
              onClick={() => save({ ...data, rows: [...data.rows, new Array(data.headers.length).fill("")] })}
              className="text-[9px] font-mono text-blue-600 hover:text-blue-700 transition flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" /> Row
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      <table className="w-full text-xs border-collapse min-w-max">
        <thead>
          <tr>
            {data.headers.map((h, hi) => (
              <th key={hi} className="border border-slate-200 bg-slate-50 px-2 py-1.5 text-left font-bold text-slate-700">
                {isOwner ? (
                  <input
                    value={h}
                    onChange={(e) => save({ ...data, headers: data.headers.map((hh, i) => i === hi ? e.target.value : hh) })}
                    className="bg-transparent w-full font-bold focus:outline-none min-w-16"
                  />
                ) : h}
              </th>
            ))}
            {isOwner && <th className="border border-slate-200 bg-slate-50 w-6" />}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-slate-200 px-2 py-1.5 text-slate-700">
                  {isOwner ? (
                    <input
                      value={cell}
                      onChange={(e) => save({ ...data, rows: data.rows.map((r, i) => i === ri ? r.map((c, j) => j === ci ? e.target.value : c) : r) })}
                      className="bg-transparent w-full focus:outline-none min-w-16"
                    />
                  ) : cell}
                </td>
              ))}
              {isOwner && (
                <td className="border border-slate-200 px-1 py-1 text-center">
                  <button
                    onClick={() => save({ ...data, rows: data.rows.filter((_, i) => i !== ri) })}
                    className="hover:text-rose-500 text-slate-300 transition"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
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
