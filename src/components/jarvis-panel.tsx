import { useState } from "react";
import { motion } from "motion/react";
import type { NoteBlock, JarvisInsight } from "@/lib/types";
import {
  Sparkles, AlertTriangle, RefreshCw, CheckSquare,
  Volume2, Square,
  CornerDownRight, TrendingDown, DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { stopSpeaking } from "@/utils/speechUtils";

interface JarvisPanelProps {
  notebookId: string;
  blocks: NoteBlock[];
  insight: JarvisInsight | null;
  onInsightUpdate: (insight: JarvisInsight) => void;
  isOpen: boolean;
  onToggle: () => void;
  onSpeak: (text: string) => void;
  isSpeaking: boolean;
  onStopSpeaking: () => void;
}

export default function JarvisPanel({
  notebookId, blocks, insight, onInsightUpdate,
  isOpen, onSpeak, isSpeaking, onStopSpeaking,
}: JarvisPanelProps) {
  const [loading, setLoading] = useState(false);

  async function runAnalysis() {
    setLoading(true);
    try {
      const notesContent = blocks
        .map((b) => {
          if (b.type === "text" || b.type === "bullets") return b.content;
          if (b.type === "table" && b.table_data) {
            const header = b.table_data.headers.join(" | ");
            const rows = b.table_data.rows.map((r) => r.join(" | ")).join("\n");
            return `${header}\n${rows}`;
          }
          if (b.type === "poll" && b.poll_data) {
            return `${b.poll_data.question}\n${b.poll_data.options.map((o) => `${o.text}: ${o.votes} votes`).join("\n")}`;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n\n");

      const { data: sessionData } = await supabase.auth.getSession();
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jarvis-analyze`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionData.session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ notesContent, notebookId }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Analysis failed (${response.status})`);
      }

      const data = await response.json();
      onInsightUpdate(data as JarvisInsight);
      toast.success("Analysis complete");
    } catch (err: any) {
      toast.error(err.message || "Failed to analyze notes");
    } finally {
      setLoading(false);
    }
  }

  function handleSpeak(text: string) {
    if (isSpeaking) { stopSpeaking(); onStopSpeaking(); return; }
    onSpeak(text);
  }

  return (
    <>
      <motion.div
        initial={false}
        animate={{ width: isOpen ? 440 : 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="h-full bg-slate-50/60 border-l border-slate-200 flex flex-col overflow-hidden select-none shadow-premium relative shrink-0"
      >
        {/* Ambient background */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-slate-200/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 bg-white flex items-center justify-between relative z-10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-slate-900 rounded-full animate-pulse" />
            <div>
              <h2 className="text-sm font-bold font-display tracking-tight text-slate-900">Sage Advisory Board</h2>
              <p className="text-[10px] text-slate-400 font-mono tracking-wider uppercase">Strategic Decision Engine</p>
            </div>
          </div>
          <button
            onClick={() => handleSpeak(insight?.shortResponse || "")}
            className={`p-2 rounded-xl border transition ${
              isSpeaking ? "bg-rose-50 border-rose-200 text-rose-600" : "bg-white border-slate-200 text-slate-500 shadow-2xs"
            }`}
          >
            {isSpeaking ? <Square className="w-3.5 h-3.5 fill-current animate-pulse" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Analysis trigger */}
        <div className="px-6 py-5 bg-white border-b border-slate-100 shrink-0">
          <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-3">Analysis & Actions</p>
          <button
            onClick={runAnalysis}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 text-white font-bold rounded-xl text-xs shadow-sm hover:shadow-md transition cursor-pointer"
          >
            <Sparkles className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Analyzing..." : "Sync Sage"}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin bg-slate-50/50">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 rounded-full border-2 border-slate-200 border-t-slate-800 animate-spin" />
              <Sparkles className="w-5 h-5 text-slate-400 animate-pulse" />
            </div>
          )}

          {!loading && !insight && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="bg-white border border-slate-200 rounded-2xl p-8 flex flex-col items-center gap-3">
                <Sparkles className="w-6 h-6 text-slate-400 animate-pulse" />
                <p className="text-xs text-slate-500 font-mono text-center max-w-[200px]">
                  No analysis yet. Click "Sync Sage" to generate strategic insights from your notes.
                </p>
              </div>
            </div>
          )}

          {!loading && insight && (
            <>
              {/* Fallback banner */}
              {insight.fallbackActive && (
                <div className="bg-amber-50/75 border border-amber-200/80 text-amber-800 rounded-xl text-[10px] font-mono uppercase tracking-wider p-3 flex items-center gap-2">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
                  </span>
                  Fallback Mode — Configure GEMINI_API_KEY for full AI analysis
                </div>
              )}

              {/* 5-Dimension Strategy Card */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950 border border-slate-800 p-5 rounded-2xl text-white shadow-xl relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-indigo-500/10 blur-xl pointer-events-none" />

                <div className="relative z-10 space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                    <span className="text-[10px] font-bold font-mono text-slate-300 uppercase tracking-widest">Executive Brief</span>
                    <span className="bg-emerald-500/25 text-emerald-300 border border-emerald-500/20 rounded-full text-[8px] font-mono font-bold px-2 py-0.5 uppercase tracking-wider">Instant WOW</span>
                  </div>

                  <p className="text-sm leading-relaxed text-slate-100">{insight.shortResponse}</p>

                  {/* Cost */}
                  {insight.decisionAnalytics?.[0] && (
                    <div className="border-t border-slate-800/40 pt-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-300 uppercase tracking-wider font-bold mb-1">
                        <DollarSign className="w-3 h-3 text-emerald-400" /> Cost
                      </div>
                      <p className="text-emerald-300 font-mono text-sm">{insight.decisionAnalytics[0].value} — {insight.decisionAnalytics[0].context}</p>
                    </div>
                  )}

                  {/* Risk */}
                  {insight.risks?.length > 0 && (
                    <div className="border-t border-slate-800/40 pt-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-300 uppercase tracking-wider font-bold mb-1">
                        <AlertTriangle className="w-3 h-3 text-amber-400" /> Risk
                        <span className="bg-amber-500/20 text-amber-300 rounded-full text-[8px] font-mono px-1.5 py-0.5">HIGH RISK</span>
                      </div>
                      <p className="text-slate-200 text-xs leading-relaxed">{insight.risks[0]}</p>
                    </div>
                  )}

                  {/* Dependencies */}
                  {insight.changingFactors?.length > 0 && (
                    <div className="border-t border-slate-800/40 pt-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-300 uppercase tracking-wider font-bold mb-1">
                        <CornerDownRight className="w-3 h-3 text-blue-400" /> Dependencies
                      </div>
                      <ul className="space-y-0.5">
                        {insight.changingFactors.slice(0, 2).map((f, i) => (
                          <li key={i} className="text-slate-200 text-xs leading-relaxed">• {f}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Blind Spot */}
                  {insight.proactiveInsight && (
                    <div className="border-t border-slate-800/40 pt-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-300 uppercase tracking-wider font-bold mb-1">
                        <TrendingDown className="w-3 h-3 text-rose-400" /> Blind Spot
                      </div>
                      <p className="text-rose-300 text-xs leading-relaxed">{insight.proactiveInsight}</p>
                    </div>
                  )}

                  {/* Suggested Action */}
                  {insight.actionItems?.[0] && (
                    <div className="border-t border-slate-800/40 pt-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-300 uppercase tracking-wider font-bold mb-1">
                        <CheckSquare className="w-3 h-3 text-blue-400" /> Suggested Action
                      </div>
                      <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5 text-blue-200 text-xs leading-relaxed">
                        ➔ {insight.actionItems[0].task}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Proactive Insight */}
              {insight.proactiveInsight && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-indigo-50/60 border border-indigo-100/80 p-5 rounded-2xl shadow-2xs hover:border-indigo-200 hover:bg-indigo-50 transition-all duration-300 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="bg-indigo-100/50 text-indigo-800 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 flex items-center gap-1">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-500" />
                      </span>
                      Proactive Insight
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed italic">{insight.proactiveInsight}</p>
                </motion.div>
              )}

              {/* Executive Summary */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-slate-900 text-white p-6 rounded-2xl shadow-premium border border-slate-800 hover:border-slate-700 transition relative"
              >
                <span className="absolute top-0 right-0 bg-slate-850 text-slate-300 rounded-bl-xl text-[9px] font-mono font-bold tracking-wider uppercase px-2.5 py-1">Core Brief</span>
                <p className="text-sm leading-relaxed text-slate-100">{insight.summary}</p>
              </motion.div>

              {/* Action Items */}
              {insight.actionItems?.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="space-y-3"
                >
                  <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Action Items</h3>
                  {insight.actionItems.map((item, i) => (
                    <div key={i} className="p-4 bg-white rounded-xl border border-slate-200 shadow-premium flex items-start justify-between hover:-translate-y-0.5 transition-all duration-200 gap-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <CheckSquare className="w-3.5 h-3.5 text-slate-700 shrink-0 mt-0.5" />
                        <p className="text-xs text-slate-800 font-medium">{item.task}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="flex items-center gap-1 text-[9px] font-mono text-slate-400">
                          <CornerDownRight className="w-2.5 h-2.5" /> {item.assignee}
                        </span>
                        <span className={`text-[9px] font-mono uppercase px-2.5 py-0.5 rounded-full border font-semibold tracking-wider ${
                          item.priority === "High"
                            ? "text-rose-600 bg-rose-50 border-rose-100"
                            : item.priority === "Medium"
                            ? "text-amber-700 bg-amber-50/50 border-amber-100"
                            : "text-emerald-600 bg-emerald-50 border-emerald-100"
                        }`}>
                          {item.priority}
                        </span>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}

              {/* SWOT */}
              {insight.swot && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.22 }}
                  className="space-y-3"
                >
                  <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">SWOT Analysis</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Strengths", items: insight.swot.strengths, dotColor: "bg-slate-400", textColor: "" },
                      { label: "Weaknesses", items: insight.swot.weaknesses, dotColor: "bg-slate-400", textColor: "" },
                      { label: "Opportunities", items: insight.swot.opportunities, dotColor: "bg-emerald-500", textColor: "text-emerald-800" },
                      { label: "Threats", items: insight.swot.threats, dotColor: "bg-rose-500", textColor: "text-rose-850" },
                    ].map(({ label, items, dotColor, textColor }) => (
                      <div key={label} className="bg-white border border-slate-100 p-4 rounded-xl hover:shadow-premium transition-all duration-200">
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                          <p className={`text-[10px] font-mono font-bold uppercase tracking-wider ${textColor || "text-slate-600"}`}>{label}</p>
                        </div>
                        <ul className="space-y-1">
                          {items?.map((item, i) => (
                            <li key={i} className="text-[11px] text-slate-600 leading-relaxed">• {item}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Strategic Themes */}
              {insight.themes?.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                  className="space-y-3"
                >
                  <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Strategic Themes</h3>
                  {insight.themes.map((theme, i) => (
                    <div key={i} className="p-5 bg-white rounded-xl border border-slate-200/85 shadow-premium hover:shadow-md transition space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-900" />
                        <p className="font-display font-bold text-sm text-slate-900">{theme.theme}</p>
                      </div>
                      <div className="space-y-2">
                        <div className="pl-3 border-l-2 border-slate-200 leading-relaxed">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-slate-400 font-bold mb-0.5">Direct Claim</p>
                          <p className="text-xs text-slate-700">{theme.whatWasSaid}</p>
                        </div>
                        <div className="pl-3 border-l-2 border-slate-200 leading-relaxed">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-slate-400 font-bold mb-0.5">Strategic Meaning</p>
                          <p className="text-xs text-slate-700">{theme.whatItMeans}</p>
                        </div>
                        <div className="pl-3 border-l-2 border-rose-100 bg-rose-50/20 leading-relaxed">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-rose-800 font-bold mb-0.5">Blindspot & Risk</p>
                          <p className="text-xs text-slate-700">{theme.whatCouldGoWrong}</p>
                        </div>
                        <div className="pl-3 border-l-2 border-amber-100 leading-relaxed">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-amber-800 font-bold mb-0.5">Unresolved Deficit</p>
                          <p className="text-xs text-slate-700">{theme.whatsMissing}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}

              {/* Contradictions */}
              {insight.contradictions?.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.28 }}
                  className="space-y-3"
                >
                  <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Contradictions</h3>
                  {insight.contradictions.map((c, i) => (
                    <div key={i} className="p-5 bg-white border border-rose-100/80 rounded-xl shadow-premium hover:-translate-y-0.5 transition space-y-2">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-rose-700 font-bold">⚠️ CONFLICT:</p>
                      <p className="text-xs text-slate-800 font-medium">{c.items}</p>
                      <div className="pl-3 border-l-2 border-rose-200">
                        <p className="text-xs text-slate-600 leading-relaxed">{c.tradeoff}</p>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}

              {/* Risks */}
              {insight.risks?.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="bg-white p-5 rounded-xl border border-rose-100 shadow-premium space-y-2"
                >
                  <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Strategic Risks</h3>
                  {insight.risks.map((risk, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-slate-700">
                      <span className="mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full bg-rose-500" />
                      <span className="leading-relaxed">{risk}</span>
                    </div>
                  ))}
                </motion.div>
              )}

              {/* Changing Factors */}
              {insight.changingFactors?.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="bg-white p-5 rounded-xl border border-slate-200 shadow-premium space-y-2"
                >
                  <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" /> Changing Factors
                  </h3>
                  {insight.changingFactors.map((factor, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-slate-700">
                      <span className="mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span className="leading-relaxed">{factor}</span>
                    </div>
                  ))}
                </motion.div>
              )}

              {/* Decision Analytics */}
              {insight.decisionAnalytics?.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="space-y-3"
                >
                  <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">Decision Analytics</h3>
                  <div className="grid grid-cols-1 gap-3">
                    {insight.decisionAnalytics.map((m, i) => (
                      <div key={i} className="p-5 bg-white rounded-xl border border-slate-200/80 shadow-premium flex items-center justify-between hover:border-slate-350 hover:-translate-y-0.5 transition-all duration-200">
                        <div>
                          <p className="text-xs font-bold text-slate-800">{m.metric}</p>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">{m.context}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <TrendingDown className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-emerald-600 font-mono font-bold text-sm">{m.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-100 bg-white shrink-0">
          <div className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-slate-400" />
            </span>
            <p className="text-[10px] text-slate-400 font-mono">Sage Live telemetry active</p>
          </div>
        </div>
      </motion.div>
    </>
  );
}
