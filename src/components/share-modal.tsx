import { useState } from "react";
import { motion } from "motion/react";
import type { Notebook, NoteBlock, JarvisInsight } from "@/lib/types";
import {
  Mail, Check, X, Download, Send, Sparkles,
  ChevronRight, ChevronLeft,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import jsPDF from "jspdf";

interface ShareModalProps {
  notebook: Notebook;
  blocks: NoteBlock[];
  insight: JarvisInsight | null;
  isOpen: boolean;
  onClose: () => void;
  onSpeak: (text: string) => void;
  isSpeaking: boolean;
}

export default function ShareModal({
  notebook, blocks, insight, isOpen, onClose,
}: ShareModalProps) {
  const [step, setStep] = useState<"preview" | "configure">("preview");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState(`Briefing: ${notebook?.title || "Notebook"}`);
  const [provider, setProvider] = useState<"gmail" | "outlook">("gmail");
  const [sending, setSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [sections, setSections] = useState({
    summary: true, notes: true, risks: true, dependencies: true,
    actions: true, swot: false, analytics: false, themes: false,
  });

  if (!isOpen) return null;

  function getBriefingText(): string {
    let text = `BRIEFING: ${notebook?.title}\n${"=".repeat(50)}\n\n`;
    if (sections.summary && insight) {
      text += `I. EXECUTIVE SUMMARY\n${insight.summary}\n\n`;
    }
    if (sections.notes && blocks.length > 0) {
      text += `II. MEETING NOTES\n`;
      blocks.forEach((b) => {
        if (b.type === "text" || b.type === "bullets") {
          text += `${b.content}\n\n`;
        } else if (b.type === "table" && b.table_data) {
          text += `${b.table_data.headers.join(" | ")}\n`;
          b.table_data.rows.forEach((r) => (text += `${r.join(" | ")}\n`));
          text += "\n";
        } else if (b.type === "poll" && b.poll_data) {
          text += `${b.poll_data.question}\n`;
          b.poll_data.options.forEach((o) => (text += `  - ${o.text}: ${o.votes} votes\n`));
          text += "\n";
        }
      });
    }
    if (sections.risks && insight?.risks?.length) {
      text += `III. STRATEGIC RISKS\n`;
      insight.risks.forEach((r) => (text += `• ${r}\n`));
      text += "\n";
    }
    if (sections.dependencies && insight?.changingFactors?.length) {
      text += `IV. CHANGING FACTORS\n`;
      insight.changingFactors.forEach((f) => (text += `• ${f}\n`));
      text += "\n";
    }
    if (sections.actions && insight?.actionItems?.length) {
      text += `V. ACTION ITEMS\n`;
      insight.actionItems.forEach((a) => (text += `[ ] ${a.task} (Owner: ${a.assignee} | ${a.priority})\n`));
      text += "\n";
    }
    if (sections.swot && insight?.swot) {
      text += `VI. SWOT\nStrengths: ${insight.swot.strengths.join("; ")}\n`;
      text += `Weaknesses: ${insight.swot.weaknesses.join("; ")}\n`;
      text += `Opportunities: ${insight.swot.opportunities.join("; ")}\n`;
      text += `Threats: ${insight.swot.threats.join("; ")}\n\n`;
    }
    if (sections.themes && insight?.themes?.length) {
      text += `VII. THEMES\n`;
      insight.themes.forEach((t) => (text += `${t.theme}: ${t.whatWasSaid} — ${t.whatItMeans}\n`));
      text += "\n";
    }
    if (sections.analytics && insight?.decisionAnalytics?.length) {
      text += `VIII. DECISION ANALYTICS\n`;
      insight.decisionAnalytics.forEach((m) => (text += `• ${m.metric}: ${m.value} — ${m.context}\n`));
    }
    return text;
  }

  function generatePDF(): jsPDF {
    const doc = new jsPDF();
    let y = 20;

    // Header bar
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 12, "F");
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text(`Briefing: ${notebook?.title || "Notebook"}`, 14, 8);

    y = 22;
    doc.setTextColor(15, 23, 42);

    if (sections.summary && insight) {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFontSize(13);
      doc.setTextColor(37, 99, 235);
      doc.text("I. EXECUTIVE SUMMARY", 14, y);
      y += 7;
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 41, 59);
      const lines = doc.splitTextToSize(insight.summary, 180);
      doc.text(lines, 14, y);
      y += lines.length * 5 + 5;
    }
    if (sections.notes && blocks.length > 0) {
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(37, 99, 235);
      doc.text("II. MEETING NOTES", 14, y);
      y += 7;
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 41, 59);
      blocks.forEach((b) => {
        if (y > 270) { doc.addPage(); y = 20; }
        if (b.type === "text" || b.type === "bullets") {
          const l = doc.splitTextToSize(b.content, 180);
          doc.text(l, 14, y);
          y += l.length * 5 + 3;
        } else if (b.type === "table" && b.table_data) {
          doc.setFont("helvetica", "bold");
          doc.text(b.table_data.headers.join("  |  "), 14, y);
          y += 5;
          doc.setFont("helvetica", "normal");
          b.table_data.rows.forEach((row) => {
            if (y > 270) { doc.addPage(); y = 20; }
            doc.text(row.join("  |  "), 14, y);
            y += 5;
          });
          y += 3;
        }
      });
    }
    if (sections.risks && insight?.risks?.length) {
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(37, 99, 235);
      doc.text("III. STRATEGIC RISKS", 14, y);
      y += 7;
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 41, 59);
      insight.risks.forEach((r) => {
        if (y > 270) { doc.addPage(); y = 20; }
        const l = doc.splitTextToSize(`• ${r}`, 180);
        doc.text(l, 14, y);
        y += l.length * 5 + 2;
      });
    }
    if (sections.actions && insight?.actionItems?.length) {
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(37, 99, 235);
      doc.text("IV. ACTION ITEMS", 14, y);
      y += 7;
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 41, 59);
      insight.actionItems.forEach((a) => {
        if (y > 270) { doc.addPage(); y = 20; }
        const l = doc.splitTextToSize(`[ ] ${a.task} (Owner: ${a.assignee} | ${a.priority})`, 180);
        doc.text(l, 14, y);
        y += l.length * 5 + 2;
      });
    }

    doc.setFontSize(8);
    doc.setFont("helvetica", "oblique");
    doc.setTextColor(148, 163, 184);
    doc.text("CONFIDENTIAL — Generated by SAGE", 14, 287);

    return doc;
  }

  function handleDownloadPDF() {
    const doc = generatePDF();
    doc.save(`Briefing_${notebook?.title?.replace(/\s+/g, "_") || "notebook"}.pdf`);
  }

  async function handleSendEmail() {
    if (!recipientEmail.trim()) {
      toast.error("Recipient email is required");
      return;
    }
    setSending(true);
    try {
      const briefingText = getBriefingText();
      const encodedSubject = encodeURIComponent(subject);
      const encodedBody = encodeURIComponent(briefingText);
      const encodedTo = encodeURIComponent(recipientEmail);

      // Open provider-specific web compose in a new tab
      let composeUrl: string;
      if (provider === "gmail") {
        composeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedTo}&su=${encodedSubject}&body=${encodedBody}`;
      } else {
        // Outlook web compose
        composeUrl = `https://outlook.office.com/mail/deepoptions?action=compose&to=${encodedTo}&subject=${encodedSubject}&body=${encodedBody}`;
      }
      window.open(composeUrl, "_blank", "noopener,noreferrer");

      try {
        await supabase.from("email_logs").insert({
          notebook_id: notebook!.id,
          recipient: recipientEmail,
          subject,
          provider,
          sections_shared: sections,
        });
      } catch {
        // Logging failure shouldn't block the user flow
      }

      setSentSuccess(true);
      toast.success(`${provider === "gmail" ? "Gmail" : "Outlook"} compose opened in a new tab`);
    } catch (err: any) {
      toast.error(err.message || "Failed to send briefing");
    } finally {
      setSending(false);
    }
  }

  function handleClose() {
    setSentSuccess(false);
    setStep("preview");
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl border border-slate-100 max-w-xl w-full overflow-hidden shadow-2xl flex flex-col relative"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-600" />
            <h3 className="font-sans font-bold text-slate-800 text-sm">Share Strategic Intelligence</h3>
            <span className="text-3xs text-slate-400 font-mono ml-2">
              {step === "preview" ? "Step 1 of 2 — Preview" : "Step 2 of 2 — Configure"}
            </span>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {sentSuccess ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center animate-bounce">
                <Check className="w-6 h-6" />
              </div>
              <div>
                <p className="font-bold text-sm text-slate-800">Compose Tab Opened</p>
                <p className="text-xs text-slate-500 mt-1">
                  {provider === "gmail" ? "Gmail" : "Outlook"} compose opened in a new tab for {recipientEmail}. Send the email from there.
                </p>
              </div>
              <button
                onClick={handleClose}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-6 py-2 rounded-xl transition shadow-premium cursor-pointer"
              >
                Done
              </button>
            </div>
          ) : step === "preview" ? (
            <>
              <div>
                <label className="block text-4xs font-bold font-mono text-slate-500 uppercase tracking-wider mb-2">
                  Briefing Preview
                </label>
                <pre className="max-h-[340px] overflow-y-auto rounded-xl bg-slate-900 text-slate-100 p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap border border-slate-800 scrollbar-thin scrollbar-thumb-slate-800">
                  {getBriefingText()}
                </pre>
              </div>
              <button
                onClick={() => setStep("configure")}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl py-2.5 text-xs shadow-sm transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                Proceed to Configure <ChevronRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              {/* Section checkboxes */}
              <div className="bg-slate-50/50 p-3.5 rounded-xl border border-slate-100 space-y-3">
                <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" /> What to share?
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key: "summary", label: "Executive Summary" },
                    { key: "notes", label: "Meeting Notes" },
                    { key: "risks", label: "Strategic Risks" },
                    { key: "dependencies", label: "Changing Factors" },
                    { key: "actions", label: "Action Items" },
                    { key: "swot", label: "SWOT Analysis" },
                    { key: "analytics", label: "Decision Analytics" },
                    { key: "themes", label: "Themes" },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(sections as any)[key]}
                        onChange={(e) => setSections({ ...sections, [key]: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-slate-700">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Recipient */}
              <div>
                <label className="block text-4xs font-bold font-mono text-slate-500 uppercase tracking-wider mb-1">
                  Recipient Email
                </label>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="partner@example.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Subject */}
              <div>
                <label className="block text-4xs font-bold font-mono text-slate-500 uppercase tracking-wider mb-1">
                  Email Subject
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Provider */}
              <div>
                <label className="block text-4xs font-bold font-mono text-slate-500 uppercase tracking-wider mb-1">
                  Choose Provider
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setProvider("gmail")}
                    className={`flex items-center justify-center gap-2 py-2 rounded-xl border text-xs font-bold transition ${
                      provider === "gmail"
                        ? "border-red-500 bg-red-50 text-red-700"
                        : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-red-500" /> Gmail
                  </button>
                  <button
                    onClick={() => setProvider("outlook")}
                    className={`flex items-center justify-center gap-2 py-2 rounded-xl border text-xs font-bold transition ${
                      provider === "outlook"
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-blue-500" /> Outlook
                  </button>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 border-t border-slate-100 pt-4">
                <button
                  onClick={() => setStep("preview")}
                  className="flex items-center gap-1 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl transition shadow-3xs cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={handleDownloadPDF}
                  className="flex items-center gap-1 px-4 py-2.5 bg-white border border-slate-200 text-blue-600 hover:bg-blue-50 text-xs font-bold rounded-xl transition shadow-3xs cursor-pointer"
                >
                  <Download className="w-4 h-4" /> PDF
                </button>
                <button
                  onClick={handleSendEmail}
                  disabled={sending}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition shadow-sm cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {sending ? "Opening..." : "Send Briefing"}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
