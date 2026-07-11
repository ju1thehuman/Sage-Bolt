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
    let text = `BRIEFING: ${notebook?.title || "Notebook"}\n${"=".repeat(50)}\n\n`;
    
    if (sections.summary && insight?.summary) {
      text += `I. STRATEGIC EXECUTIVE SUMMARY\n"${insight.summary}"\n\n`;
    }
    
    if (sections.notes && blocks.length > 0) {
      text += `II. BRAINBOARD MEETING NOTES\n`;
      blocks.forEach((b) => {
        if (b.type === "text" && b.content) {
          text += `${b.content}\n\n`;
        }
        if (b.type === "bullets" && b.content) {
          text += `${b.content}\n\n`;
        }
        if (b.type === "table" && b.table_data) {
          text += `${b.table_data.headers.join(" | ")}\n`;
          b.table_data.rows.forEach((r) => (text += `${r.join(" | ")}\n`));
          text += "\n";
        }
        if (b.type === "poll" && b.poll_data) {
          text += `${b.poll_data.question}\n`;
          b.poll_data.options.forEach((o) => (text += `  - ${o.text}: ${o.votes} votes\n`));
          text += "\n";
        }
      });
      text += `\n`;
    }
    
    if (sections.risks && insight?.risks && insight.risks.length > 0) {
      text += `III. CRITICAL STRATEGIC RISKS & BLINDSPOTS\n`;
      const uniqueRisks = Array.from(new Set(insight.risks));
      uniqueRisks.forEach((r) => { text += `• ${r}\n`; });
      text += `\n`;
    }
    
    if (sections.dependencies && insight?.changingFactors && insight.changingFactors.length > 0) {
      text += `IV. SHIFTING VARIABLES & DEPENDENCIES\n`;
      const uniqueFactors = Array.from(new Set(insight.changingFactors));
      uniqueFactors.forEach((cf) => { text += `• ${cf}\n`; });
      text += `\n`;
    }
    
    if (sections.actions && insight?.actionItems && insight.actionItems.length > 0) {
      text += `V. DELIVERABLE ACTION ROADMAP\n`;
      const seenActions = new Set();
      insight.actionItems.forEach((ai) => {
        if (seenActions.has(ai.task)) return;
        seenActions.add(ai.task);
        text += `[ ] ${ai.task} (Owner: ${ai.assignee} | Priority: ${ai.priority})\n`;
      });
      text += `\n`;
    }

    if (sections.swot && insight?.swot) {
      text += `VI. SWOT MATRIX ANALYSIS\n`;
      text += `STRENGTHS:\n${insight.swot.strengths.map(s => `• ${s}`).join("\n")}\n\n`;
      text += `WEAKNESSES:\n${insight.swot.weaknesses.map(w => `• ${w}`).join("\n")}\n\n`;
      text += `OPPORTUNITIES:\n${insight.swot.opportunities.map(o => `• ${o}`).join("\n")}\n\n`;
      text += `THREATS:\n${insight.swot.threats.map(t => `• ${t}`).join("\n")}\n\n`;
    }

    if (sections.analytics && insight?.decisionAnalytics && insight.decisionAnalytics.length > 0) {
      text += `VII. DECISION ANALYTICS & METRICS\n`;
      insight.decisionAnalytics.forEach((m) => {
        text += `• ${m.metric}: ${m.value} (${m.context})\n`;
      });
      text += `\n`;
    }

    if (sections.themes && insight?.themes && insight.themes.length > 0) {
      text += `VIII. CO-FOUNDER THEMATIC BRAINBOARD ANALYSIS\n`;
      insight.themes.forEach((t) => {
        text += `Theme: ${t.theme}\n`;
        text += `  • What Was Said: ${t.whatWasSaid}\n`;
        text += `  • What It Means: ${t.whatItMeans}\n`;
        text += `  • What Could Go Wrong: ${t.whatCouldGoWrong}\n`;
        text += `  • What's Missing: ${t.whatsMissing}\n\n`;
      });
    }

    return text.trim() || "No sections selected. Please toggle the checkboxes below to compile your briefing.";
  }

  function generatePDF(): jsPDF {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
    let y = 20;

    // Title / Cover branding with premium navy bar header
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, 210, 8, "F");

    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text("EXECUTIVE BRIEFING", 14, y);
    y += 10;

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105); // slate-600
    doc.text(`Subject: ${notebook?.title || "Notebook"}`, 14, y);
    y += 6;
    doc.text(`Created on: ${new Date().toLocaleDateString()} | 2026`, 14, y);
    y += 10;

    // Line separator
    doc.setDrawColor(226, 232, 240);
    doc.line(14, y, 196, y);
    y += 10;

    // 1. Share Summary Section
    if (sections.summary && insight?.summary) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(37, 99, 235); // blue-600
      doc.text("I. STRATEGIC EXECUTIVE SUMMARY", 14, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59); // slate-800
      const splitSummary = doc.splitTextToSize(insight.summary, 180);
      doc.text(splitSummary, 14, y);
      y += (splitSummary.length * 5) + 8;
    }

    // 2. Share Notes Section
    if (sections.notes && blocks.length > 0) {
      if (y > 240) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(37, 99, 235); // blue-600
      doc.text("II. BRAINBOARD MEETING NOTES", 14, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);

      blocks.forEach((block) => {
        if (y > 255) {
          doc.addPage();
          y = 20;
        }

        if (block.type === "text" && block.content) {
          const splitContent = doc.splitTextToSize(block.content, 180);
          doc.text(splitContent, 14, y);
          y += (splitContent.length * 5) + 6;
        } else if (block.type === "bullets" && block.content) {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(71, 85, 105);
          doc.text("Directives & Guidelines:", 14, y);
          y += 5;
          doc.setFont("helvetica", "normal");
          doc.setTextColor(30, 41, 59);
          
          const bulletLines = block.content.split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0);
          const uniqueLines = Array.from(new Set(bulletLines));

          uniqueLines.forEach((line) => {
            const cleanText = line.replace(/^[•\-\*\d\.\s]+/g, "").trim();
            if (!cleanText) return;
            const splitBullet = doc.splitTextToSize(`• ${cleanText}`, 175);
            doc.text(splitBullet, 18, y);
            y += (splitBullet.length * 5) + 2.5;
          });
          y += 4;
        } else if (block.type === "table" && block.table_data) {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(71, 85, 105);
          doc.text("Structured Matrix Grid:", 14, y);
          y += 6;
          doc.setFont("helvetica", "normal");
          doc.setTextColor(30, 41, 59);

          const headers = block.table_data.headers;
          const rows = block.table_data.rows;
          
          let colX = 14;
          const colWidth = 180 / headers.length;

          // Headers row background
          doc.setFillColor(241, 245, 249);
          doc.rect(14, y - 4, 180, 7, "F");
          doc.setFont("helvetica", "bold");
          headers.forEach((hdr, idx) => {
            doc.text(hdr, colX + (idx * colWidth), y);
          });
          y += 7;

          // Rows
          doc.setFont("helvetica", "normal");
          rows.forEach((row) => {
            row.forEach((cell, idx) => {
              const cleanCell = cell.trim();
              doc.text(cleanCell.substring(0, 24), colX + (idx * colWidth), y);
            });
            y += 6;
            if (y > 275) {
              doc.addPage();
              y = 20;
            }
          });
          y += 6;
        }
      });
      y += 4;
    }

    // 3. Share Risks Section
    if (sections.risks && insight?.risks && insight.risks.length > 0) {
      if (y > 230) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(220, 38, 38); // red-600
      doc.text("III. CRITICAL STRATEGIC RISKS & BLINDSPOTS", 14, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);

      const uniqueRisks = Array.from(new Set(insight.risks));
      uniqueRisks.forEach((risk) => {
        const cleanRisk = risk.replace(/^[•\-\*\d\.\s]+/g, "").trim();
        if (!cleanRisk) return;
        const splitRisk = doc.splitTextToSize(`• ${cleanRisk}`, 180);
        doc.text(splitRisk, 14, y);
        y += (splitRisk.length * 5) + 3;
        if (y > 275) { doc.addPage(); y = 20; }
      });
      y += 6;
    }

    // 4. Share Dependencies Section
    if (sections.dependencies && insight?.changingFactors && insight.changingFactors.length > 0) {
      if (y > 230) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(13, 148, 136); // teal-600
      doc.text("IV. SHIFTING VARIABLES & DEPENDENCIES", 14, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);

      const uniqueFactors = Array.from(new Set(insight.changingFactors));
      uniqueFactors.forEach((factor) => {
        const cleanFactor = factor.replace(/^[•\-\*\d\.\s]+/g, "").trim();
        if (!cleanFactor) return;
        const splitFactor = doc.splitTextToSize(`• ${cleanFactor}`, 180);
        doc.text(splitFactor, 14, y);
        y += (splitFactor.length * 5) + 3;
        if (y > 275) { doc.addPage(); y = 20; }
      });
      y += 6;
    }

    // 5. Share Actions Items
    if (sections.actions && insight?.actionItems && insight.actionItems.length > 0) {
      if (y > 230) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(37, 99, 235); // blue-600
      doc.text("V. DELIVERABLE ACTION ROADMAP", 14, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);

      const seenActions = new Set();
      insight.actionItems.forEach((item) => {
        if (seenActions.has(item.task)) return;
        seenActions.add(item.task);

        const itemLine = `[ ] ${item.task} (Owner: ${item.assignee} | Priority: ${item.priority})`;
        const splitItem = doc.splitTextToSize(itemLine, 180);
        doc.text(splitItem, 14, y);
        y += (splitItem.length * 5) + 3.5;
        if (y > 275) { doc.addPage(); y = 20; }
      });
    }

    // 6. SWOT Section
    if (sections.swot && insight?.swot) {
      if (y > 230) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(37, 99, 235); // blue-600
      doc.text("VI. SWOT MATRIX ANALYSIS", 14, y);
      y += 8;

      const swot = insight.swot;
      const categories = [
        { title: "Strengths (S)", items: swot.strengths, color: [30, 41, 59] },
        { title: "Weaknesses (W)", items: swot.weaknesses, color: [100, 116, 139] },
        { title: "Opportunities (O)", items: swot.opportunities, color: [5, 150, 105] },
        { title: "Threats (T)", items: swot.threats, color: [220, 38, 38] },
      ];

      categories.forEach((cat) => {
        if (y > 245) { doc.addPage(); y = 20; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        doc.setTextColor(cat.color[0], cat.color[1], cat.color[2]);
        doc.text(cat.title, 14, y);
        y += 5;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(30, 41, 59);
        
        cat.items.forEach((item) => {
          const cleanItem = item.replace(/^[•\-\*\d\.\s]+/g, "").trim();
          const splitItem = doc.splitTextToSize(`• ${cleanItem}`, 180);
          doc.text(splitItem, 18, y);
          y += (splitItem.length * 4.5) + 2;
          if (y > 275) { doc.addPage(); y = 20; }
        });
        y += 3;
      });
      y += 4;
    }

    // 7. Decision Analytics Section
    if (sections.analytics && insight?.decisionAnalytics && insight.decisionAnalytics.length > 0) {
      if (y > 230) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(37, 99, 235); // blue-600
      doc.text("VII. DECISION ANALYTICS & METRICS", 14, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);

      insight.decisionAnalytics.forEach((m) => {
        const textLine = `• ${m.metric}: ${m.value} — ${m.context}`;
        const splitText = doc.splitTextToSize(textLine, 180);
        doc.text(splitText, 14, y);
        y += (splitText.length * 5) + 2.5;
        if (y > 275) { doc.addPage(); y = 20; }
      });
      y += 4;
    }

    // 8. Themes Section
    if (sections.themes && insight?.themes && insight.themes.length > 0) {
      if (y > 230) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(37, 99, 235); // blue-600
      doc.text("VIII. CO-FOUNDER THEMATIC BRAINBOARD ANALYSIS", 14, y);
      y += 8;

      insight.themes.forEach((theme) => {
        if (y > 240) { doc.addPage(); y = 20; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(71, 85, 105);
        doc.text(`Theme: ${theme.theme}`, 14, y);
        y += 5;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(30, 41, 59);

        const details = [
          `What Was Said: ${theme.whatWasSaid}`,
          `What It Means: ${theme.whatItMeans}`,
          `What Could Go Wrong: ${theme.whatCouldGoWrong}`,
          `What's Missing: ${theme.whatsMissing}`,
        ];

        details.forEach((det) => {
          const splitDet = doc.splitTextToSize(`• ${det}`, 175);
          doc.text(splitDet, 18, y);
          y += (splitDet.length * 4.5) + 1.5;
          if (y > 275) { doc.addPage(); y = 20; }
        });
        y += 2;
      });
    }

    // Confidential footer branding
    doc.setFontSize(8);
    doc.setFont("helvetica", "oblique");
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text("CONFIDENTIAL - FOR BOARD OF DIRECTORS ONLY • GENERATED BY SAGE INTELLECT", 14, 287);

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
    setSentSuccess(false);

    const briefingText = getBriefingText();
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1e293b; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <div style="background-color: #0f172a; padding: 16px; border-radius: 8px 8px 0 0; text-align: center; margin: -20px -20px 20px -20px;">
          <h2 style="color: #ffffff; margin: 0; font-size: 18px; font-weight: bold; font-family: sans-serif;">Sage Strategic Briefing</h2>
        </div>
        <h3 style="color: #0f172a; font-size: 16px; font-weight: bold; margin-top: 0;">Subject: ${subject}</h3>
        <div style="white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: #334155; font-family: monospace; background-color: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #f1f5f9;">${briefingText}</div>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 11px; color: #94a3b8; font-style: italic; text-align: center; margin: 0;">
          CONFIDENTIAL & PRIVILEGED &mdash; Generated by SAGE Executive Intellect
        </p>
      </div>
    `;

    try {
      const resendKey = "re_3xUWt6YR_Afje9PpVXqLeBT6yCfXYXJ4G";

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Sage Collaborator <onboarding@resend.dev>",
          to: recipientEmail.split(",").map(e => e.trim()),
          subject: subject,
          html: htmlBody,
        }),
      });

      if (!res.ok) {
        throw new Error(`Resend API returned status ${res.status}`);
      }

      try {
        await supabase.from("email_logs").insert({
          notebook_id: notebook!.id,
          recipient: recipientEmail,
          subject,
          provider: "resend",
          sections_shared: sections,
        });
      } catch (dbErr) {
        console.warn("Failed to log email to Supabase:", dbErr);
      }

      setSentSuccess(true);
      toast.success("Briefing sent successfully!");
    } catch (err: any) {
      console.warn("Direct Resend email dispatch failed (e.g. CORS block). Falling back to client ecosystem compose tab...", err);

      try {
        const encodedSubject = encodeURIComponent(subject);
        const encodedBody = encodeURIComponent(briefingText);
        const encodedTo = encodeURIComponent(recipientEmail);

        let composeUrl: string;
        if (provider === "gmail") {
          composeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedTo}&su=${encodedSubject}&body=${encodedBody}`;
        } else {
          composeUrl = `https://outlook.office.com/mail/deepoptions?action=compose&to=${encodedTo}&subject=${encodedSubject}&body=${encodedBody}`;
        }
        window.open(composeUrl, "_blank", "noopener,noreferrer");

        await supabase.from("email_logs").insert({
          notebook_id: notebook!.id,
          recipient: recipientEmail,
          subject,
          provider,
          sections_shared: sections,
        });

        setSentSuccess(true);
        toast.success(`Compose tab opened in new window via ${provider === "gmail" ? "Gmail" : "Outlook"}`);
      } catch (fallbackErr: any) {
        toast.error(fallbackErr.message || "Failed to initiate email compose");
      }
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
