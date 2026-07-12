import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  BadgeCheck,
  BadgeDollarSign,
  BarChart3,
  Bot,
  BotMessageSquare,
  Brain,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  CircleX,
  Clock3,
  Copy,
  CopyPlus,
  CreditCard,
  Download,
  ExternalLink,
  Facebook,
  Eye,
  FilePenLine,
  FileSearch,
  Flame,
  Gauge,
  History,
  Instagram,
  LayoutDashboard,
  Lightbulb,
  Linkedin,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  Mic,
  MessageSquareReply,
  MessageSquareText,
  NotebookText,
  Package,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Plus,
  Printer,
  RefreshCw,
  Rocket,
  ScanSearch,
  Search,
  Send,
  Settings2,
  Save,
  ShieldCheck,
  Sparkles,
  SquareArrowOutUpRight,
  Target,
  Trophy,
  TrendingUp,
  Trash2,
  Twitter,
  WandSparkles,
  Workflow,
  TriangleAlert,
  X,
} from "lucide-vue-next";
import type { Component } from "vue";

export const iconSizes = {
  default: 20,
  dense: 16,
} as const;

export const iconStrokeWidth = 1.85;

export const navigationIcons = {
  dashboard: LayoutDashboard,
  ideas: Lightbulb,
  assets: Package,
  brand: Palette,
  planner: CalendarDays,
  automation: Bot,
  history: History,
  growth: TrendingUp,
  outreach: Megaphone,
  revenue: BadgeDollarSign,
  email: Mail,
  blog: NotebookText,
  analytics: BarChart3,
  settings: Settings2,
  admin: ShieldCheck,
  billing: CreditCard,
  create: Sparkles,
} as const;

export const actionIcons = {
  add: Plus,
  approve: BadgeCheck,
  arrowDownRight: ArrowDownRight,
  arrowRight: ArrowRight,
  arrowUpDown: ArrowUpDown,
  arrowUpRight: ArrowUpRight,
  close: X,
  collapseSidebar: PanelLeftClose,
  copy: Copy,
  copyPlus: CopyPlus,
  delete: Trash2,
  denseSort: ArrowUpDown,
  download: Download,
  edit: PencilLine,
  externalLink: ExternalLink,
  expandSidebar: PanelLeftOpen,
  eye: Eye,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  logOut: LogOut,
  menu: Menu,
  open: SquareArrowOutUpRight,
  preview: Eye,
  print: Printer,
  refresh: RefreshCw,
  save: Save,
  search: Search,
  send: Send,
  warning: TriangleAlert,
} as const;

export const aiFeatureIcons = {
  assistant: BotMessageSquare,
  automation: Bot,
  brainstorm: Brain,
  capture: ScanSearch,
  generate: Sparkles,
  insight: Workflow,
  idea: Lightbulb,
  planning: CalendarClock,
  publish: Rocket,
  voice: Mic,
  rewrite: WandSparkles,
  prompt: MessageSquareText,
  summary: MessageSquareText,
} as const;

export const analyticsIcons = {
  activity: Activity,
  overview: BarChart3,
  performance: Gauge,
  timing: Clock3,
  trend: TrendingUp,
  reach: Target,
  consistency: Flame,
  workflow: Workflow,
  health: ShieldCheck,
} as const;

export const platformIcons = {
  facebook: Facebook,
  instagram: Instagram,
  linkedin: Linkedin,
  x: Twitter,
} as const;

export const prospectStatusIcons = {
  default: CircleDollarSign,
  new: Sparkles,
  researching: Search,
  research_ready: FileSearch,
  draft_ready: FilePenLine,
  approved: BadgeCheck,
  sent: Send,
  replied: MessageSquareReply,
  follow_up: Clock3,
  follow_up_due: Clock3,
  meeting_booked: CalendarCheck2,
  closed_won: Trophy,
  closed_lost: CircleX,
  engaged: ArrowUpRight,
  trial: BadgeCheck,
  converted: TrendingUp,
  churned: CircleX,
  active: ArrowUpRight,
  inactive: CircleX,
} as const;

type ProspectStatusIconKey = keyof typeof prospectStatusIcons;

function normalizeStatusKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

export function resolveProspectStatusIcon(status: string): Component {
  const normalized = normalizeStatusKey(status);

  if (normalized in prospectStatusIcons) {
    return prospectStatusIcons[normalized as ProspectStatusIconKey];
  }

  switch (normalized) {
    case "researching":
    case "research-ready":
      return prospectStatusIcons.researching;
    case "researchready":
      return prospectStatusIcons.research_ready;
    case "draftready":
      return prospectStatusIcons.draft_ready;
    case "followup":
      return prospectStatusIcons.follow_up;
    case "followupdue":
      return prospectStatusIcons.follow_up_due;
    case "meetingbooked":
      return prospectStatusIcons.meeting_booked;
    case "closedwon":
      return prospectStatusIcons.closed_won;
    case "closedlost":
      return prospectStatusIcons.closed_lost;
    case "not_interested":
    case "dead":
      return prospectStatusIcons.closed_lost;
    default:
      return prospectStatusIcons.default;
  }
}

export type LucideIcon = Component;
