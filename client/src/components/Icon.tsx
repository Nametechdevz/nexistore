import {
  ArrowLeft, ArrowRight, BadgeCheck, BarChart3, Bell, BookOpen, Box, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert,
  Clock, Copy, CreditCard, Crown, Download, Eye, EyeOff, FileText, Filter, Gamepad2, Gift, GraduationCap, Headphones, Heart,
  House, Info, KeyRound, LayoutDashboard, LifeBuoy, ListChecks, Lock, LogOut, Mail, MapPin, Menu, Minus, Monitor, Music, Package,
  Palette, Pencil, Percent, Phone, Plus, Receipt, RefreshCw, Search, Settings, ShieldCheck, ShoppingBag, ShoppingCart, Smartphone,
  Sparkles, Star, Tag, Tags, Ticket, Trash2, Truck, Tv, User, Users, Wallet, X, Zap,
  type LucideIcon, type LucideProps,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "arrow-left": ArrowLeft, "arrow-right": ArrowRight, "badge-check": BadgeCheck, chart: BarChart3, bell: Bell, book: BookOpen, box: Box,
  check: Check, "chevron-down": ChevronDown, "chevron-left": ChevronLeft, "chevron-right": ChevronRight, alert: CircleAlert, clock: Clock,
  copy: Copy, card: CreditCard, crown: Crown, download: Download, eye: Eye, "eye-off": EyeOff, file: FileText, filter: Filter,
  "gamepad-2": Gamepad2, gift: Gift, "graduation-cap": GraduationCap, headphones: Headphones, heart: Heart, home: House, info: Info,
  key: KeyRound, dashboard: LayoutDashboard, support: LifeBuoy, list: ListChecks, lock: Lock, logout: LogOut, mail: Mail, pin: MapPin,
  menu: Menu, minus: Minus, monitor: Monitor, music: Music, package: Package, palette: Palette, pencil: Pencil, percent: Percent,
  phone: Phone, plus: Plus, receipt: Receipt, refresh: RefreshCw, search: Search, settings: Settings, shield: ShieldCheck,
  bag: ShoppingBag, cart: ShoppingCart, smartphone: Smartphone, sparkles: Sparkles, star: Star, tag: Tag, tags: Tags, ticket: Ticket,
  trash: Trash2, truck: Truck, tv: Tv, user: User, users: Users, wallet: Wallet, x: X, zap: Zap,
};

export const ICON_NAMES = Object.keys(ICONS);

export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const C = ICONS[name] ?? Tag;
  return <C aria-hidden="true" strokeWidth={2} {...props} />;
}
