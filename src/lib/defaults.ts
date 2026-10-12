export type Gender = "Men" | "Women";
export interface CampaignRule { vertical: string; mrp_from: number; mrp_to: number }
export interface Campaign { name: string; gender: Gender; active: boolean; rules: CampaignRule[]; fromReport?: string /* Flipkart campaign id it was created from */ }
export interface Settings {
  brand: string;
  min_qoh: number;
  min_sizes_select: number;
  min_live_sizes: number;
  core_men: string[];
  core_women: string[];
  allow_overlap: boolean; // true = an FSN can be in every campaign whose rules it matches
}
export interface Config { settings: Settings; campaigns: Campaign[] }

export const DEFAULT_SETTINGS: Settings = {
  brand: "ASICS",
  min_qoh: 10,
  min_sizes_select: 4,
  min_live_sizes: 3,
  core_men: ["7", "8", "9", "10"],
  core_women: ["4", "5", "6", "7"],
  allow_overlap: true,
};

const r = (vertical: string, mrp_from: number, mrp_to: number): CampaignRule => ({ vertical, mrp_from, mrp_to });

export const DEFAULT_CAMPAIGNS: Campaign[] = [
  { name: "SpRunningShoes - Low MRP", gender: "Men", active: true, rules: [r("SpRunningShoes", 3499, 9999)] },
  { name: "SpRunningShoes - High MRP", gender: "Men", active: true, rules: [r("SpRunningShoes", 10999, 16999)] },
  { name: "SpSneakers - Low MRP", gender: "Men", active: true, rules: [r("SpSneakers", 3799, 6999)] },
  { name: "SpSneakers - High MRP", gender: "Men", active: true, rules: [r("SpSneakers", 7499, 14999)] },
  { name: "CPS - Low MRP", gender: "Men", active: true,
    rules: [r("SpCricketShoes", 5999, 6999), r("SpBadmintonShoes", 4499, 8999), r("SpCourtShoes", 5999, 6999)] },
  { name: "CPS - High MRP", gender: "Men", active: true,
    rules: [r("SpCricketShoes", 10999, 15999), r("SpBadmintonShoes", 9999, 10999), r("SpCourtShoes", 8999, 10999)] },
  { name: "Women Running", gender: "Women", active: true, rules: [r("WomenRunningShoes", 0, 99999)] },
  { name: "Women Sneaker", gender: "Women", active: true, rules: [r("WomenCasualShoeMisc", 0, 99999), r("WomenSlipOns", 0, 99999)] },
  { name: "Women CPS", gender: "Women", active: true, rules: [r("WomenBadmintonAndCourtShoes", 0, 99999)] },
];

export const DEFAULT_CONFIG: Config = { settings: DEFAULT_SETTINGS, campaigns: DEFAULT_CAMPAIGNS };

export const REQUIRED_COLUMNS = [
  "inv_fsn", "item_id", "inv_super_category", "inv_vertical", "model_name", "article_number",
  "color", "mrp_amount", "qoh", "uk_india_size", "final_size_fw",
] as const;
