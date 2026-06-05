export interface DealDraft {
  description?: string;
  amount?: string;
  currency?: string;
}

export interface SessionData {
  step?: string;
  dealDraft?: DealDraft;
}
