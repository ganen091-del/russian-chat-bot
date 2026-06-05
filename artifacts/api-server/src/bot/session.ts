export interface DealDraft {
  role?: "seller" | "buyer";
  description?: string;
  amount?: string;
  currency?: string;
}

export interface SessionData {
  step?: string;
  dealDraft?: DealDraft;
  joinDealCode?: string;
}
