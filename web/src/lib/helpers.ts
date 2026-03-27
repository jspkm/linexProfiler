import type { ApiRecord } from "./types";

export function formatChatTimestamp(date: Date) {
  const stamp = date.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return stamp.replace(", ", ", ").replace(" AM", "AM").replace(" PM", "PM");
}

export const GREETING_RE = /^(h(i|ello|ey|owdy|ola)|yo|sup|what'?s\s*up|good\s*(morning|afternoon|evening|day)|gm|gn|thanks?(\s*you)?|ty|bye|cya|see\s*ya|cheers|greetings|ok|okay|k|cool|nice|lol|lmao|haha|wow|yep|yea(h)?|nope|no|yes)[!?.\s]*$/i;
export const GIBBERISH_RE = /^[^a-zA-Z]*$|^(.)\1{4,}$|^[a-z]{1,2}$/i;
export const isGibberish = (s: string) => GIBBERISH_RE.test(s) || (s.length <= 6 && !/[aeiou]/i.test(s)) || /^[^a-zA-Z0-9]*$/.test(s);

const CANNED: Record<string, string[]> = {
  greeting: ["Hey! Ask me anything about your portfolio or spending data.", "Hello! How can I help with your portfolio today?", "Hi there! Ready to analyze some data."],
  gibberish: ["I didn't quite catch that. Try asking about your portfolio or spending patterns.", "Could you rephrase that? I'm here to help with financial insights."],
};
export const pickCanned = (kind: "greeting" | "gibberish") => CANNED[kind][Math.floor(Math.random() * CANNED[kind].length)];

export const GRID_FIELDS: Record<string, string> = {
  original_portfolio_ltv: "Original LTV before optimization",
  new_gross_portfolio_ltv: "LTV after incentives, before cost",
  portfolio_cost: "Cost of assigned incentives",
  lift: "Revenue lift from incentives",
  new_net_portfolio_ltv: "Final LTV (net of cost)",
};

/** Try to compile a formula string from the backend into a safe row evaluator */
export const compileFormula = (formula: string): ((r: Record<string, number>) => number) | null => {
  const allowedFields = Object.keys(GRID_FIELDS);
  let expr = formula;
  for (const f of allowedFields.sort((a, b) => b.length - a.length)) {
    expr = expr.replace(new RegExp(`\\b${f}\\b`, "g"), `r.${f}`);
  }
  const sanitized = expr.replace(/r\.\w+/g, "0").replace(/[0-9.+\-*/() \t]/g, "");
  if (sanitized.length > 0) return null;
  try {
    const fn = new Function("r", `"use strict"; const v = ${expr}; return typeof v === 'number' && isFinite(v) ? v : 0;`) as (r: Record<string, number>) => number;
    fn({ original_portfolio_ltv: 1, new_gross_portfolio_ltv: 2, portfolio_cost: 1, lift: 0.5, new_net_portfolio_ltv: 1.5 });
    return fn;
  } catch {
    return null;
  }
};

export function formatCustomColValue(val: number, format: "dollar" | "percent" | "ratio" | "number") {
  if (!isFinite(val)) return "—";
  switch (format) {
    case "dollar": return `$${Math.round(val).toLocaleString("en-US")}`;
    case "percent": return `${(val * 100).toFixed(1)}%`;
    case "ratio": return val.toFixed(2);
    default: return val.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
}

export function formatToon(profile: ApiRecord, rec: ApiRecord) {
  let profileToon = "linex_profile:\n profile:\n";
  if (profile.raw_toon) {
    profileToon = profile.raw_toon;
  } else if (profile.attributes) {
    for (const [key, attr] of Object.entries(profile.attributes)) {
      const a = attr as ApiRecord;
      profileToon += `  ${key}: ${a.value} [${a.confidence}]\n`;
    }
  }

  let recToon = " card_recommendation:\n";
  if (rec.raw_toon) {
    recToon = rec.raw_toon.replace("linex_profile:\n", "");
  } else if (rec.recommendations) {
    const fields = "card_id,card_name,issuer,fit_score,match,estimated_annual_value,description";
    recToon += `  recommendations[${rec.recommendations.length}]{${fields}}:\n`;
    for (const r of rec.recommendations) {
      recToon += `   ${r.card_id},${r.card_name},${r.issuer},${r.fit_score},${r.why_it_matches},${r.estimated_annual_reward_value},${r.description}\n`;
    }
  }

  if (!profileToon.endsWith('\n')) profileToon += '\n';
  return profileToon + recToon;
}

export const ALL_STATEMENTS = [
  "Brewing up something good...",
  "Let me dig into this...",
  "Hmm, let me see...",
  "One moment...",
  "Cooking up an answer...",
  "Poking around...",
  "Down the rabbit hole...",
  "Crunching the numbers...",
  "Dusting off the archives...",
  "Connecting the dots...",
  "Rummaging through my brain...",
  "Give me a sec...",
  "Chewing on this...",
  "Putting on my thinking cap...",
  "Let me work my magic...",
  "Diving in...",
  "Spinning up the gears...",
  "Cracking open the books...",
  "Hold my coffee...",
  "Summoning the answer...",
  "Untangling this...",
  "Sniffing out the details...",
  "Rolling up my sleeves...",
  "Consulting the oracle...",
];
