import { useState } from "react";
import { motion } from "motion/react";
import { Sparkles, AlertCircle, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    try {
      if (mode === "signup") {
        const name = displayName.trim() || email.split("@")[0];
        const { error: err } = await signUp(email, password, name);
        if (err) {
          setError(err);
        } else {
          toast.success("Account created! You're signed in.");
        }
      } else {
        const { error: err } = await signIn(email, password);
        if (err) {
          setError(err);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Decorative grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30" />

      {/* Glowing center blob */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-900/10 rounded-full blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-md w-full bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-8 shadow-2xl relative z-10 flex flex-col space-y-6"
      >
        {/* Logo Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex w-12 h-12 rounded-xl bg-gradient-to-tr from-slate-900 to-slate-800 border border-slate-700/50 items-center justify-center font-black text-xl text-white shadow-lg shadow-black/20">
            S
          </div>
          <div>
            <h1 className="font-sans font-bold text-lg text-slate-100 tracking-tight">Sage Workspace</h1>
            <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest mt-1">Leadership Intelligence Portal</p>
          </div>
        </div>

        {/* Instructional HUD */}
        <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/40 text-xs text-slate-300 leading-relaxed space-y-1.5 font-sans">
          <div className="flex items-center gap-1 text-[10px] font-mono text-blue-400 uppercase tracking-wider font-bold">
            <Sparkles className="w-3.5 h-3.5" /> {mode === "signin" ? "Welcome Back" : "New Identity"}
          </div>
          <p>
            {mode === "signin"
              ? "Authenticate to access secure workspaces, async board syncs, and executive summarization features."
              : "Create your account to join collaborative brainstorm boards and access strategic AI advisory insights."}
          </p>
        </div>

        {/* Error banner */}
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="bg-rose-950/40 border border-rose-900/50 text-rose-200 text-xs p-3.5 rounded-xl flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <div className="space-y-1 leading-relaxed">
              <span className="font-bold">Authentication Error:</span> {error}
            </div>
          </motion.div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="block text-4xs font-mono font-bold text-slate-500 uppercase mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-semibold"
                placeholder="e.g. Jane Doe"
              />
            </div>
          )}
          <div>
            <label className="block text-4xs font-mono font-bold text-slate-500 uppercase mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-semibold"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-4xs font-mono font-bold text-slate-500 uppercase mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-semibold"
              placeholder="At least 6 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white hover:bg-slate-100 disabled:bg-slate-800 disabled:text-slate-500 text-slate-900 rounded-xl py-3 font-bold text-xs transition duration-200 shadow-md flex items-center justify-center gap-2.5 cursor-pointer"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            {mode === "signin" ? "Authenticate & Enter" : "Create Account & Enter"}
          </button>
        </form>

        {/* Mode toggle */}
        <button
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="w-full text-center text-3xs font-mono uppercase text-slate-500 hover:text-slate-300 transition"
        >
          {mode === "signin" ? "No account? Create one →" : "Already registered? Sign in →"}
        </button>

        {/* Security label */}
        <div className="text-[10px] text-slate-600 font-mono text-center flex items-center justify-center gap-1.5">
          <span>🔒 Fully Cryptographically Isolated Sessions</span>
        </div>
      </motion.div>
    </div>
  );
}
