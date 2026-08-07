export interface Policy {
  pattern: RegExp;
  answer: string;
}

export const POLICIES: ReadonlyArray<Policy> = [
  {
    pattern: /refund|return/i,
    answer: "Customers may request a refund within 30 days of purchase.",
  },
  {
    pattern: /exchange/i,
    answer: "You may exchange an item within 14 days of delivery.",
  },
  {
    pattern: /shipping|deliver/i,
    answer: "Orders ship within 2 business days and arrive within 5 business days.",
  },
  {
    pattern: /cancel/i,
    answer: "Orders may be canceled at any time before delivery.",
  },
  {
    pattern: /warranty/i,
    answer: "Products are covered by a 1-year limited warranty.",
  },
  {
    pattern: /personal data|privacy/i,
    answer: "We do not sell your personal data.",
  },
];
