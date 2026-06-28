export type MatchmakerFilters = {
  photographerType?: string;
  minHourlyRate?: number;
  maxHourlyRate?: number;
  availabilityDays?: string[];
  locations?: string[];
  keywords?: string[];
  minRating?: number;
};

export interface LLMProvider {
  readonly name: string;
  parseMatchmakerQuery(prompt: string): Promise<MatchmakerFilters>;
}
