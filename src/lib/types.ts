export interface Profile {
  id: string;
  display_name: string;
  avatar_initials: string;
  color: string;
  created_at: string;
}

export interface Notebook {
  id: string;
  title: string;
  user_id: string;
  last_updated: string;
  created_at: string;
}

export interface Collaborator {
  id: string;
  notebook_id: string;
  user_id: string;
  role: string;
  created_at: string;
  profile?: Profile;
}

export type BlockType = "text" | "table" | "bullets" | "poll";

export interface TableData {
  headers: string[];
  rows: string[][];
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
}

export interface PollData {
  question: string;
  options: PollOption[];
  voted_user_ids: string[];
}

export interface NoteBlock {
  id: string;
  notebook_id: string;
  position: number;
  type: BlockType;
  content: string;
  table_data: TableData | null;
  poll_data: PollData | null;
  font_size: string;
  bold: boolean;
  italic: boolean;
  highlight_color: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailLog {
  id: string;
  notebook_id: string;
  user_id: string;
  recipient: string;
  subject: string;
  provider: string;
  sections_shared: {
    notes: boolean;
    summary: boolean;
    risks: boolean;
    dependencies: boolean;
    actions?: boolean;
    swot?: boolean;
    analytics?: boolean;
    themes?: boolean;
  };
  created_at: string;
}

export interface ActionItem {
  task: string;
  assignee: string;
  priority: string;
}

export interface DecisionMetric {
  metric: string;
  value: string;
  context: string;
}

export interface Theme {
  theme: string;
  whatWasSaid: string;
  whatItMeans: string;
  whatCouldGoWrong: string;
  whatsMissing: string;
}

export interface Contradiction {
  items: string;
  tradeoff: string;
}

export interface SwotAnalysis {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

export interface JarvisInsight {
  shortResponse: string;
  summary: string;
  actionItems: ActionItem[];
  risks: string[];
  changingFactors: string[];
  decisionAnalytics: DecisionMetric[];
  themes: Theme[];
  contradictions: Contradiction[];
  swot: SwotAnalysis;
  proactiveInsight: string;
  fallbackActive?: boolean;
}

export interface Tag {
  id: string;
  name: string;
}

export interface Insight {
  id: string;
  notebook_id: string;
  user_id: string;
  analysis: JarvisInsight;
  created_at: string;
}
