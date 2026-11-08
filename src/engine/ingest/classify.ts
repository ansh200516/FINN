/**
 * Announcement classifier — deterministic first, LLM only for the residue.
 *
 * Stage A: exact map on NSE `desc` (the exchange's own subject category).
 * Stage B: ordered regex cascade over desc + attchmntText (+ voiceSummary,
 *          + attachment text when available).
 * Stage C: residue (confidence < threshold) → ONE batched Flash-Lite call
 *          (≤ 40 items) returning category/tier/reason per item.
 *
 * Cue strings come from the measured samples in docs/research/05 §6, 14 §4
 * and 02 §4.2. The subcategory is the hook the priority model uses to tell
 * routine variants (newspaper copy, CP allotment, meet schedule) from the
 * material ones. Every result carries the cue that fired so the UI can show why.
 */
import { z } from "zod";
import { logger } from "@/lib/logger";
import { computePriority } from "../analyse/priority";
import { callStructured } from "../llm/gateway";
import {
  type AnnouncementRaw,
  CATEGORIES,
  type Category,
  type Classification,
  type Tier,
} from "../types";
import { eventKeyFor } from "./dedupe";

const log = logger.child({ mod: "engine/ingest/classify" });

export interface RuleClassification {
  category: Category;
  subcategory?: string;
  /** 0..1 — exact desc map 0.95, text cue 0.75–0.9, fall-through 0.4 */
  confidence: number;
  /** the rule that fired, e.g. "desc:Credit Rating" or "re:transcript" */
  cue: string;
}

export const RESIDUE_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Stage A — exact NSE `desc` map (unambiguous values only)
// ---------------------------------------------------------------------------

type DescRule = { category: Category; subcategory?: string };

const DESC_EXACT: Readonly<Record<string, DescRule>> = {
  acquisition: { category: "m_and_a" },
  "amalgamation/merger": { category: "m_and_a" },
  "scheme of arrangement": { category: "m_and_a" },
  demerger: { category: "m_and_a" },
  "joint venture": { category: "m_and_a", subcategory: "jv" },
  "sale or disposal": { category: "m_and_a" },
  "open offer": { category: "m_and_a" },
  delisting: { category: "m_and_a" },
  "other restructuring": { category: "m_and_a", subcategory: "restructuring" },
  "updates on acquisition": { category: "m_and_a", subcategory: "update" },
  "integrated filing- financial": {
    category: "results",
    subcategory: "integrated_filing",
  },
  "financial result updates": { category: "results" },
  "investor presentation": { category: "results", subcategory: "presentation" },
  "certificate under sebi (depositories and participants) regulations, 2018": {
    category: "unclassified",
    subcategory: "certificate",
  },
  "esop/esos/esps": { category: "unclassified", subcategory: "esop" },
  "options to purchase securities": {
    category: "unclassified",
    subcategory: "esop",
  },
  "trading window": { category: "unclassified", subcategory: "trading_window" },
  "closure of trading window": {
    category: "unclassified",
    subcategory: "trading_window",
  },
  "monitoring agency report": {
    category: "unclassified",
    subcategory: "admin",
  },
  "statement of deviation(s) or variation(s) under reg. 32": {
    category: "unclassified",
    subcategory: "admin",
  },
  "structural digital database": {
    category: "unclassified",
    subcategory: "certificate",
  },
  "giving guarantees/indemnity/ becoming a surety for third party": {
    category: "unclassified",
    subcategory: "admin",
  },
  "action(s) taken or orders passed": { category: "litigation" },
  "action(s) initiated": { category: "litigation" },
  "corporate insolvency resolution process": {
    category: "litigation",
    subcategory: "cirp",
  },
  "pendency of litigation(s)": { category: "litigation" },
  "initiation of forensic audit": {
    category: "litigation",
    subcategory: "regulatory",
  },
  "fraud/default": { category: "litigation", subcategory: "regulatory" },
  "credit rating": { category: "credit_rating" },
  "credit rating- revision": {
    category: "credit_rating",
    subcategory: "change",
  },
  "credit rating- new": { category: "credit_rating", subcategory: "new" },
  "change in management": { category: "management_change" },
  "change in director(s)": { category: "management_change" },
  "change in directorate": { category: "management_change" },
  appointment: { category: "management_change" },
  resignation: { category: "management_change" },
  "resignation of director/kmp/smp": { category: "management_change" },
  cessation: { category: "management_change" },
  retirement: { category: "management_change" },
  demise: { category: "management_change" },
  // auditor vs auditor_appointment is decided from the text (rotation is routine, resignation is a flag)
  "change in auditors": { category: "management_change" },
  "resignation of statutory auditor": {
    category: "management_change",
    subcategory: "auditor",
  },
  "change in company secretary/compliance officer": {
    category: "management_change",
    subcategory: "cs",
  },
  dividend: { category: "dividend", subcategory: "declaration" },
  bonus: { category: "bonus_split" },
  "bonus issue": { category: "bonus_split" },
  "stock split": { category: "bonus_split" },
  "issue of securities": { category: "fund_raise" },
  "rights issue": { category: "fund_raise", subcategory: "equity" },
  buyback: { category: "fund_raise", subcategory: "buyback" },
  "fund raising": { category: "fund_raise" },
  "bagging/receiving of orders/contracts": {
    category: "press_release",
    subcategory: "order_win",
  },
  "news verification": { category: "press_release", subcategory: "rumour" },
  "rumour verification - regulation 30(11)": {
    category: "press_release",
    subcategory: "rumour",
  },
  "spurt in volume": { category: "press_release", subcategory: "spurt" },
  "price movement": { category: "press_release", subcategory: "spurt" },
  "monthly business updates": {
    category: "press_release",
    subcategory: "business_update",
  },
  "product launch": { category: "press_release", subcategory: "product" },
  "capacity addition": { category: "capex" },
  "commencement of commercial production": { category: "capex" },
  "new line of business": { category: "capex" },
  "disclosure under sebi takeover regulations": { category: "insider_trading" },
  "insider trading / sast": { category: "insider_trading" },
  "postal ballot": { category: "postal_ballot" },
  "annual report": { category: "agm_egm", subcategory: "annual_report" },
};

// ---------------------------------------------------------------------------
// Stage B — regex cascade (ordered; first match wins)
// ---------------------------------------------------------------------------

const RE = {
  newspaper: /newspaper|news ?paper|advertisement|clippings|publication of/i,
  resultsStrong:
    /financial results?|results? for the (quarter|period|half)|un-?audited|\baudited\b|limited review|integrated filing|investor presentation|earnings presentation|analyst presentation|report of auditors|quarterly report w\.?r\.?t|extract of .{0,40}results|q[1-4] (results|press|investor|&|and)|results? (announcement|press release)|posts record q|announces financial results/i,
  bmIntimation:
    /meeting of the board of directors .{0,80}(scheduled|to be held|will be held)|board meeting (to be held|scheduled|intimation)|intimation of board meeting|to consider and approve .{0,40}(results|dividend)|to announce .{0,30}results|announce .{0,30}quarter results/i,
  routineStrong:
    /\besop\b|\besos\b|\besps\b|employee stock|stock options?|restricted stock|certificate under|reg(ulation)?\.? ?74\s*\(5\)|reg(ulation)?\.? ?40\s*\(/i,
  routineAdmin:
    /reconciliation of share capital|monitoring agency|statement of deviation|trading window|loss of share|duplicate share|secretarial compliance|\besg\b|\bbrsr\b|sustainab|registrar|share transfer agent|\brta\b|letter of comfort|guarantee|indemnity|committee meeting|structural digital database|\bsdd\b|special window|dematerialisation|physical shares|social media communication|code of conduct|change in (the )?address|corporate office|registered office|website|general updates$|^updates?$/i,
  callMoney:
    /reminder notice|first and final call|final call money|call money|payment of (the )?(first|second|final) call/i,
  procedural:
    /closure of (the )?issue|issue period|confirmation of application|basis of allotment|dispatch|reminder|intimation as per regulation \d+|listing and trading approval|credit of (rights|equity)|record date for (the )?(purpose of )?rights/i,
  earningsCall:
    /transcript|audio recording|recording of|link of (audio )?recording|earnings (conference )?call|post[- ]earnings|conference call|con\.? ?call|concall|results? call|analyst call|investor call|earnings call/i,
  callSchedule:
    /scheduled|will (hold|be held)|to be held|invite|intimation of|schedule of|dial-?in|hereby inform.{0,40}call/i,
  dividend: /dividend/i,
  bonusSplit:
    /bonus (issue|share)|stock split|sub-?division|split of (equity|shares)|face value .{0,30}(from|to)/i,
  pledge: /pledg|encumbr|invocation|invoked|reg(ulation)?\.? ?31\s*\(/i,
  insider:
    /insider trading|\bpit\b|reg(ulation)?\.? ?7\s*\(2\)|\bsast\b|takeover regulations|reg(ulation)?\.? ?29\s*\(|trading plan/i,
  mgmt: /\bappoint|re-?appoint|resign|cessation|cease[sd]? to|retire|demise|passed away|superannuat|chief (executive|financial|operating|technology|compliance|risk|human)|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|\bcro\b|managing director|whole[- ]?time director|executive director|independent director|non-?executive director|additional director|(?<!board of )(?<!board of the )directors?\b|company secretary|compliance officer|key managerial|senior management|statutory auditor|change in management|change in director/i,
  /** text-driven mode: an action verb within one sentence of a board/KMP role noun */
  mgmtAction:
    /(?:\bappoint|re-?appoint|\bresign|cessation|cease[sd]? to|\bretire|demise|passed away|superannuat|re-?designat|vacat(?:e|ed|ion) (?:the )?office|relinquish|stepp?(?:ed|ing)? down|elevat).{0,120}?(?:director|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|chief|managing|chairman|chairperson|company secretary|\bkmp\b|key managerial|senior management|auditor)|(?:director|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|chief|managing|chairman|chairperson|company secretary|\bkmp\b|key managerial|senior management|auditor).{0,120}?(?:\bappoint|re-?appoint|\bresign|cessation|cease[sd]? to|\bretire|demise|passed away|superannuat|re-?designat|relinquish|stepp?(?:ed|ing)? down|elevat)/i,
  esgGuard: /\besg\b|brsr|sustainab|climate/i,
  creditRating:
    /credit rating|rating (action|upgrade|downgrade|reaffirm|assign|revision|rationale|watch)|\bcrisil\b|\bicra\b|\bcare ratings?\b|india ratings|brickwork|acuit[eé]|infomerics|moody|s&p global|fitch/i,
  ratingChange:
    /downgrad|upgrad|revis|outlook .{0,20}(negative|positive|stable|changed|revised)|placed on (rating )?watch|withdraw|reaffirm/i,
  ratingReaffirm: /reaffirm|re-?affirm|affirmed|retained|maintained/i,
  litigation:
    /litigation|arbitration|\bcourt\b|tribunal|\bnclt\b|\bnclat\b|sebi (order|interim|confirmatory)|order from sebi|\bsebi\b.{0,20}\border\b|penalty|penalties|show[- ]cause|insolvency|\bcirp\b|forensic|orders? passed|disput|adjudicat|demand notice|gst (order|notice|demand)|tax demand|search and seizure|\bseizure\b|\bfraud\b|default in|warning letter|regulatory action|action\(s\) taken/i,
  taxRoutine:
    /\bgst\b|tax demand|penalty of rs\.? ?[\d,]+|no (material )?impact/i,
  subsidiaryIpo:
    /initial public offer(ing)?|\bipo\b|red herring prospectus|\bdrhp\b|\bofs\b|offer for sale|trading in (the )?equity shares of .{0,80}will commence|listing of (the )?equity shares of/i,
  licence:
    /grant of approval|approval (from|by|of) (the )?(sebi|rbi|us ?fda|usfda|dcgi|cdsco|irdai|nhai)|licen[cs]e|certificate of registration|registered as|regulatory approval|approved in the u\.?s\.?|\bnod\b/i,
  mna: /acqui(sition|re|red|ring)|merger|amalgamation|demerger|scheme of arrangement|joint venture|\bjv\b|\bstake\b|divest|slump sale|share purchase agreement|business transfer agreement|takeover|open offer|incorporation of (a |an )?(wholly|subsidiary|new)|wholly[- ]owned subsidiary|step[- ]down subsidiary|subsidiary|associate company|strike[- ]?off|wind(ing)?[- ]up|dissolution of|disposal of|sale of (entire|stake|shares)/i,
  fundRaise:
    /\bqip\b|qualified institution|rights (issue|basis|entitlement)|preferential (issue|allotment)|buy-?back|commercial paper|debenture|\bncds?\b|non[- ]convertible|fund[- ]?rais|raising of funds|allotment of (securities|equity|shares|warrants?)|\bwarrants?\b|borrowing|term loan|issue of securities|issue period|private placement|public offer/i,
  debtInstrument: /non[- ]convertible|\bncds?\b|debenture|bonds?\b/i,
  cp: /commercial paper|\bcps?\b/i,
  equityInstrument:
    /\bqip\b|qualified institution|rights (issue|basis|entitlement)|preferential|\bwarrants?\b|equity shares on|partly paid/i,
  capex:
    /\bcapex\b|capacity (expansion|addition|enhancement)|new (plant|facility|unit|campus|development cent(re|er)|manufacturing)|greenfield|brownfield|commissioning|commencement of commercial production|expansion of|capital expenditure|doubles? .{0,30}capacity|production capacity|capacity of \d/i,
  postalBallot: /postal ballot/i,
  agmEgm:
    /annual general meeting|\bagm\b|extra-?ordinary general meeting|\begm\b|\beogm\b|shareholders'? meeting|scrutini[sz]er|voting results|annual report/i,
  investorMeet:
    /investor (meet|conference|day|forum)|analysts?[/ ]investor meet|analyst (meet|day)|schedule of (analyst|investor|meet)|roadshow|one-on-one|group meeting|institutional investors?/i,
  orderWin:
    /order (win|book|received|worth|valued)|bagging|receipt of order|letter of award|contract (worth|valued|from)|awarded|secures|wins? (an? )?(order|contract)|work order/i,
  csr: /\bcsr\b|foundation|climate|emission|award(s)? (ceremony|announced)|winners of|felicitat|day of|livelihood|scholarship/i,
  pressGeneric:
    /press release|media (release|statement)|launch|partnership|partner|collaborat|clarification|rumou?r|news (item|report)|business update|store opening|sales (volume|update)|production|\bwins\b|selects|delivers|announces|unveil|strengthen|moderni[sz]ation|expands|signs|agreement|mou\b|tie-?up|alliance|statement/i,
} as const;

function lc(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The attachment filename often carries the only real hint
 * ("..._OrderFromSEBI.pdf", "..._Schedule_of_Conference_call.pdf"). Strip the
 * symbol prefix + 14-digit timestamp and split camelCase/underscores.
 */
export function fileHint(url: string | null | undefined): string {
  if (!url) return "";
  const base = url.split("/").pop() ?? "";
  const stem = base.replace(/\.[a-z0-9]{2,4}$/i, "");
  const parts = stem.split(/[_\-.]+/).filter((p) => !/^\d{6,}$/.test(p));
  // drop the leading symbol-like token (ALLCAPS or Capitalised company token)
  if (parts.length > 1 && /^[A-Za-z0-9]{2,12}$/.test(parts[0] ?? ""))
    parts.shift();
  return parts
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Subject-first: the filing's own subject names the role; the PDF (an omnibus) only when the subject is silent. */
function mgmtSubcategoryFor(subjectText: string, fullText: string): string {
  const fromSubject = mgmtSubcategory(subjectText);
  return fromSubject !== "other" ? fromSubject : mgmtSubcategory(fullText);
}

/** Drop the sign-off block ("Yours faithfully … Company Secretary") and the SEBI annexure's reason-row boilerplate. */
export function stripSignOff(text: string): string {
  return text
    .replace(/yours (faithfully|truly|sincerely)[\s\S]*$/i, "")
    .replace(/thanking you[\s\S]*$/i, "")
    .replace(/reason for change \(viz\.?[^)]*\)/gi, "reason for change")
    .replace(
      /\b(appointment|resignation|removal|death or otherwise)(,|\s+or)\s+(?=(resignation|removal|death))/gi,
      "",
    )
    .replace(
      /\b(company secretary|compliance officer|authori[sz]ed signatory)\b/gi,
      "",
    );
}

function mgmtSubcategory(text: string): string {
  if (
    /statutory auditor|change in auditor|auditors? (resign|appoint)/i.test(text)
  ) {
    // routine rotation/appointment is Tier 2; a resignation is the red flag (Tier 1)
    return /auditors? (has |have )?(resign|withdraw)|resignation of (the )?(statutory )?auditor|casual vacancy|auditors?.{0,60}(resign|withdraw)|(resign|withdraw)[a-z]*.{0,60}auditor/i.test(
      text,
    )
      ? "auditor"
      : "auditor_appointment";
  }
  if (
    /completed (his|her|their) .{0,20}term|completion of (his|her|their) .{0,20}term|term (of|as) .{0,40}(ended|expire|complet)|retire(ment)? by rotation/i.test(
      text,
    )
  )
    return "term_end";
  if (/re-?designat/i.test(text)) return "redesignation";
  if (
    /chief (executive|financial|operating|technology|risk)|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|managing director|\bmd\b|whole[- ]?time director|executive director|chairman|chairperson|chairwoman|promoter/i.test(
      text,
    )
  )
    return "cxo";
  if (
    /joint company secretary|deputy company secretary|assistant company secretary/i.test(
      text,
    )
  )
    return "cs_junior";
  if (/company secretary|compliance officer/i.test(text)) return "cs";
  if (
    /independent director|non-?executive director|additional director|nominee director|director\b/i.test(
      text,
    )
  )
    return "director";
  if (
    /senior management|\bsmp\b|\bkmp\b|chief|head of|president|vice president/i.test(
      text,
    )
  )
    return "smp";
  return "other";
}

function fundRaiseSubcategory(text: string): string | undefined {
  if (RE.callMoney.test(text)) return "call_money";
  if (/allot(ment|ted)/i.test(text) && RE.equityInstrument.test(text))
    return "equity";
  if (RE.procedural.test(text)) return "procedural";
  if (RE.cp.test(text)) return "cp";
  if (/buy-?back/i.test(text)) return "buyback";
  if (RE.equityInstrument.test(text)) return "equity";
  if (RE.debtInstrument.test(text)) return "debt";
  return undefined;
}

function litigationSubcategory(text: string): string | undefined {
  if (/\bcirp\b|insolvency|\bnclt\b|\bnclat\b/i.test(text)) return "cirp";
  if (
    /sebi (order|interim|confirmatory|adjudicat|penalty|show cause)|order from sebi|\brbi\b|forensic|\bfraud\b|search and seizure|\bseizure\b|enforcement directorate|\bcbi\b/i.test(
      text,
    )
  )
    return "regulatory";
  if (RE.taxRoutine.test(text)) return "tax";
  return undefined;
}

function ratingSubcategory(text: string): string | undefined {
  if (
    /downgrad|upgrad|outlook .{0,20}(negative|positive|revised|changed)|placed on (rating )?watch|withdraw|revis/i.test(
      text,
    )
  )
    return "change";
  if (RE.ratingReaffirm.test(text)) return "reaffirm";
  if (/assign|new rating|initial rating/i.test(text)) return "new";
  return undefined;
}

function pressSubcategory(text: string): string | undefined {
  if (RE.orderWin.test(text)) return "order_win";
  if (
    /clarification|rumou?r|news (item|report)|sought clarification/i.test(text)
  )
    return "rumour";
  if (RE.csr.test(text)) return "csr";
  if (
    /spurt|price movement|volume/i.test(text) &&
    /clarif|movement|spurt/i.test(text)
  )
    return "spurt";
  if (RE.licence.test(text)) return "approval";
  if (
    /business update|sales (volume|update)|monthly|production (volume|update)/i.test(
      text,
    )
  )
    return "business_update";
  if (/launch|unveil|introduc/i.test(text)) return "product";
  return undefined;
}

/**
 * Deterministic classification. `extraText` is the first part of the
 * attachment text when it has been downloaded (second pass).
 */
export function classifyRules(
  raw: AnnouncementRaw,
  extraText?: string,
): RuleClassification {
  const desc = lc(raw.desc);
  const subject = lc(raw.attchmntText);
  const voice = lc(raw.voiceSummary);
  const hint = fileHint(raw.attchmntFile);
  /** subject + exchange summary + filename hint (no desc — the desc has its own stage) */
  const sv = `${subject} ${voice} ${hint}`;
  const body = `${desc} ${sv}`;
  const full = extraText ? `${body} ${lc(extraText).slice(0, 4000)}` : body;

  // ---- Stage A: exact desc map ------------------------------------------
  const exact = DESC_EXACT[desc];
  if (exact) {
    const r: RuleClassification = {
      category: exact.category,
      subcategory: exact.subcategory,
      confidence: 0.95,
      cue: `desc:${raw.desc}`,
    };
    // refine subcategories from text where it matters
    if (exact.category === "management_change" && !r.subcategory)
      r.subcategory = mgmtSubcategoryFor(sv, full);
    if (exact.category === "credit_rating" && !r.subcategory) {
      r.subcategory = ratingSubcategory(full);
      if (!r.subcategory) r.confidence = 0.85; // category sure, action unknown until the PDF is read
    }
    if (exact.category === "fund_raise" && !r.subcategory)
      r.subcategory = fundRaiseSubcategory(full);
    if (exact.category === "litigation" && !r.subcategory)
      r.subcategory = litigationSubcategory(full);
    if (exact.category === "m_and_a" && !r.subcategory) {
      if (/incorporat/i.test(full) && /wholly|subsidiary|section 8/i.test(full))
        r.subcategory = "wos_incorporation";
      else if (
        /strike[- ]?off|dissolution|wind(ing)?[- ]up|voluntary liquidation/i.test(
          full,
        )
      )
        r.subcategory = "restructuring";
      else if (
        /update on|updates on|in furtherance|completion of/i.test(subject)
      )
        r.subcategory = "update";
    }
    if (exact.category === "insider_trading" && RE.pledge.test(full)) {
      r.category = "pledging";
      r.cue = `${r.cue}+re:pledge`;
    }
    if (exact.category === "press_release" && exact.subcategory === "order_win")
      r.subcategory = "order_win";
    return r;
  }

  // ---- Stage A': desc values that need one text cue -----------------------
  if (desc === "copy of newspaper publication") {
    if (RE.resultsStrong.test(body) || /results|q[1-4]\b/i.test(body)) {
      return {
        category: "results",
        subcategory: "newspaper",
        confidence: 0.9,
        cue: "desc:newspaper+re:results",
      };
    }
    return {
      category: "unclassified",
      subcategory: "newspaper",
      confidence: 0.9,
      cue: "desc:newspaper",
    };
  }
  if (desc === "analysts/institutional investor meet/con. call updates") {
    // the desc itself says "Con. Call", so only the subject/summary/filename count here
    const scheduled = RE.callSchedule.test(sv);
    if (RE.bmIntimation.test(sv) && RE.resultsStrong.test(sv)) {
      return {
        category: "results",
        subcategory: "bm_intimation",
        confidence: 0.85,
        cue: "desc:analyst-meet+re:bm-intimation",
      };
    }
    if (/transcript/i.test(sv) && !scheduled)
      return {
        category: "earnings_call",
        subcategory: "transcript",
        confidence: 0.95,
        cue: "desc:analyst-meet+re:transcript",
      };
    if (/recording/i.test(sv) && !scheduled)
      return {
        category: "earnings_call",
        subcategory: "recording",
        confidence: 0.95,
        cue: "desc:analyst-meet+re:recording",
      };
    if (/presentation/i.test(sv))
      return {
        category: "results",
        subcategory: "presentation",
        confidence: 0.85,
        cue: "desc:analyst-meet+re:presentation",
      };
    if (RE.earningsCall.test(sv) || /q[1-4]\b|quarter|results/i.test(sv)) {
      return {
        category: "earnings_call",
        subcategory: "schedule",
        confidence: 0.9,
        cue: "desc:analyst-meet+re:call",
      };
    }
    return {
      category: "investor_meetings",
      confidence: 0.9,
      cue: "desc:analyst-meet",
    };
  }
  if (desc === "shareholders meeting") {
    if (RE.postalBallot.test(body)) {
      const sub = /result|scrutini|voting/i.test(body) ? "results" : "notice";
      return {
        category: "postal_ballot",
        subcategory: sub,
        confidence: 0.95,
        cue: "desc:shareholders-meeting+re:postal",
      };
    }
    const sub = /proceeding|scrutini|voting|outcome/i.test(body)
      ? "proceedings"
      : "notice";
    return {
      category: "agm_egm",
      subcategory: sub,
      confidence: 0.95,
      cue: "desc:shareholders-meeting",
    };
  }
  if (desc === "record date") {
    if (RE.dividend.test(body))
      return {
        category: "dividend",
        subcategory: "record_date",
        confidence: 0.95,
        cue: "desc:record-date+re:dividend",
      };
    if (RE.bonusSplit.test(body))
      return {
        category: "bonus_split",
        subcategory: "record_date",
        confidence: 0.9,
        cue: "desc:record-date+re:bonus",
      };
    if (/interest|ncd|debenture/i.test(body))
      return {
        category: "unclassified",
        subcategory: "admin",
        confidence: 0.85,
        cue: "desc:record-date+re:interest",
      };
    return {
      category: "dividend",
      subcategory: "record_date",
      confidence: 0.6,
      cue: "desc:record-date",
    };
  }
  if (desc === "allotment of securities") {
    if (RE.routineStrong.test(body))
      return {
        category: "unclassified",
        subcategory: "esop",
        confidence: 0.95,
        cue: "desc:allotment+re:esop",
      };
    const sub = fundRaiseSubcategory(body);
    return {
      category: "fund_raise",
      subcategory: sub,
      confidence: sub ? 0.95 : 0.8,
      cue: `desc:allotment${sub ? `+re:${sub}` : ""}`,
    };
  }
  if (desc === "outcome of board meeting") {
    if (RE.resultsStrong.test(body) || /\bresults?\b|q[1-4]\b/i.test(body)) {
      return {
        category: "results",
        subcategory: "outcome",
        confidence: 0.95,
        cue: "desc:outcome+re:results",
      };
    }
    // the omnibus board outcome: with the PDF text, results cues win; otherwise look for the other
    // board matters (resignation, dividend, fund raise, acquisition) before assuming results
    const head = extraText ? stripSignOff(lc(extraText).slice(0, 3000)) : "";
    if (head && RE.resultsStrong.test(head)) {
      return {
        category: "results",
        subcategory: "outcome",
        confidence: 0.85,
        cue: "desc:outcome+text:results",
      };
    }
    const other = cascade(
      head ? `${body} ${head}` : body,
      head ? `${body} ${head}` : body,
      Boolean(head),
    );
    if (
      other &&
      other.category !== "unclassified" &&
      other.category !== "earnings_call" &&
      other.confidence >= 0.75
    ) {
      return {
        ...other,
        confidence: Math.min(other.confidence, 0.8),
        cue: `desc:outcome+${other.cue}`,
      };
    }
    return {
      category: "results",
      subcategory: "outcome",
      confidence: extraText ? 0.75 : 0.6,
      cue: "desc:outcome",
    };
  }
  if (desc === "agreements") {
    if (RE.mna.test(body))
      return {
        category: "m_and_a",
        subcategory: "agreement",
        confidence: 0.85,
        cue: "desc:agreements+re:mna",
      };
    return {
      category: "press_release",
      subcategory: "partnership",
      confidence: 0.75,
      cue: "desc:agreements",
    };
  }

  // ---- Stage B: generic desc (Updates / General Updates / Press Release / unknown) ----
  // content-free subjects ("…regarding 'Updates'", "disclosure under Regulation 30 …") get the
  // first part of the attachment text as matching material when it has been downloaded
  const stripped = subject
    .replace(
      /^.{0,80}?has (informed|submitted)( to)? the exchange( about| regarding| that|,)?\s*/i,
      "",
    )
    .replace(/['"‘’“”.\s]+$/g, "")
    .trim();
  const contentFree =
    /^(general updates?|updates?|disclosure under regulation 30[^.]*|intimation under regulation 30[^.]*|regulation 30[^.]*)$/i.test(
      stripped,
    );
  const matchText =
    contentFree && extraText
      ? `${body} ${stripSignOff(lc(extraText).slice(0, 2500))}`
      : body;
  const b = cascade(
    matchText === body ? full : matchText,
    matchText,
    matchText !== body,
  );
  if (b) {
    if (matchText !== body) b.confidence = Math.min(b.confidence, 0.78);
    if (desc === "press release" && b.category === "unclassified") {
      return {
        category: "press_release",
        subcategory: pressSubcategory(body),
        confidence: 0.8,
        cue: "desc:press-release",
      };
    }
    return b;
  }
  if (desc === "press release") {
    return {
      category: "press_release",
      subcategory: pressSubcategory(body),
      confidence: 0.8,
      cue: "desc:press-release",
    };
  }
  if (desc === "disclosure of material issue") {
    return {
      category: "litigation",
      confidence: 0.5,
      cue: "desc:material-issue",
    };
  }
  return { category: "unclassified", confidence: 0.4, cue: "fallthrough" };
}

/** The ordered regex cascade. `full` includes attachment text; `body` is desc+subject+voice only. */
/**
 * The ordered regex cascade. `full` includes attachment text; `body` is what
 * the cues are matched against; `textDriven` says `body` carries attachment
 * text (content-free subject), which tightens the management-change rule.
 */
function cascade(
  full: string,
  body: string,
  textDriven = false,
): RuleClassification | null {
  // a. newspaper copies / advertisements
  if (RE.newspaper.test(body) && !/press release|media/i.test(body)) {
    if (RE.resultsStrong.test(body) || /results/i.test(body)) {
      return {
        category: "results",
        subcategory: "newspaper",
        confidence: 0.85,
        cue: "re:newspaper+results",
      };
    }
    if (RE.dividend.test(body))
      return {
        category: "dividend",
        subcategory: "newspaper",
        confidence: 0.8,
        cue: "re:newspaper+dividend",
      };
    return {
      category: "unclassified",
      subcategory: "newspaper",
      confidence: 0.85,
      cue: "re:newspaper",
    };
  }
  // b. strong routine markers
  if (RE.routineStrong.test(body))
    return {
      category: "unclassified",
      subcategory: "esop",
      confidence: 0.9,
      cue: "re:routine-strong",
    };
  if (RE.callMoney.test(body) && /reminder|notice/i.test(body)) {
    return {
      category: "fund_raise",
      subcategory: "call_money",
      confidence: 0.85,
      cue: "re:call-money",
    };
  }
  if (
    RE.esgGuard.test(body) &&
    !RE.creditRating.test(body.replace(/esg ratings?/g, ""))
  ) {
    return {
      category: "unclassified",
      subcategory: "admin",
      confidence: 0.85,
      cue: "re:esg",
    };
  }
  if (
    RE.routineAdmin.test(body) &&
    !RE.resultsStrong.test(body) &&
    !RE.mgmt.test(body) &&
    !RE.mna.test(body)
  ) {
    return {
      category: "unclassified",
      subcategory: "admin",
      confidence: 0.8,
      cue: "re:routine-admin",
    };
  }
  // b'. a subsidiary's IPO / listing (checked before results: the text often mentions the subsidiary's results date)
  if (
    RE.subsidiaryIpo.test(body) &&
    /subsidiar|platforms limited|of [a-z .&]+ (limited|ltd)/i.test(body) &&
    !RE.newspaper.test(body)
  ) {
    return {
      category: "m_and_a",
      subcategory: "subsidiary_ipo",
      confidence: 0.8,
      cue: "re:subsidiary-ipo",
    };
  }
  // c. earnings call
  if (RE.earningsCall.test(body)) {
    const sub = /transcript/i.test(body)
      ? "transcript"
      : /recording/i.test(body)
        ? "recording"
        : "schedule";
    return {
      category: "earnings_call",
      subcategory: sub,
      confidence: 0.9,
      cue: `re:earnings-call/${sub}`,
    };
  }
  // d. results (incl. presentation / press release on results / auditor report / BM intimation)
  if (RE.resultsStrong.test(body)) {
    let sub = "outcome";
    if (/presentation/i.test(body)) sub = "presentation";
    else if (/press release|press/i.test(body)) sub = "press_release";
    else if (/report of auditors|auditor'?s report/i.test(body))
      sub = "auditor_report";
    else if (RE.bmIntimation.test(body)) sub = "bm_intimation";
    else if (/quarterly report w\.?r\.?t/i.test(body)) sub = "auditor_report";
    return {
      category: "results",
      subcategory: sub,
      confidence: 0.85,
      cue: `re:results/${sub}`,
    };
  }
  if (RE.bmIntimation.test(body) && /results|dividend|quarter/i.test(body)) {
    return {
      category: "results",
      subcategory: "bm_intimation",
      confidence: 0.85,
      cue: "re:bm-intimation",
    };
  }
  // e. dividend / bonus
  if (RE.dividend.test(body)) {
    const sub = /record date/i.test(body)
      ? "record_date"
      : /payment/i.test(body)
        ? "payment"
        : "declaration";
    return {
      category: "dividend",
      subcategory: sub,
      confidence: 0.85,
      cue: `re:dividend/${sub}`,
    };
  }
  if (RE.bonusSplit.test(body))
    return { category: "bonus_split", confidence: 0.85, cue: "re:bonus-split" };
  // f. pledge / insider
  if (RE.pledge.test(body)) {
    const sub = /invo[ck]/i.test(body)
      ? "invocation"
      : /releas|revoc/i.test(body)
        ? "release"
        : "creation";
    return {
      category: "pledging",
      subcategory: sub,
      confidence: 0.85,
      cue: `re:pledge/${sub}`,
    };
  }
  if (RE.insider.test(body)) {
    const sub = /promoter/i.test(body) ? "promoter" : undefined;
    return {
      category: "insider_trading",
      subcategory: sub,
      confidence: 0.85,
      cue: "re:insider",
    };
  }
  // g. management change — when only attachment text is available, demand an action verb
  //    (signature blocks say "Company Secretary" / "Director" on every filing)
  if (RE.mgmt.test(body) && (!textDriven || RE.mgmtAction.test(body))) {
    return {
      category: "management_change",
      subcategory: mgmtSubcategoryFor(body, full),
      confidence: 0.8,
      cue: "re:mgmt",
    };
  }
  // h. credit rating
  if (RE.creditRating.test(body)) {
    return {
      category: "credit_rating",
      subcategory: ratingSubcategory(full),
      confidence: 0.85,
      cue: "re:credit-rating",
    };
  }
  // i. litigation
  if (RE.litigation.test(body)) {
    return {
      category: "litigation",
      subcategory: litigationSubcategory(full),
      confidence: 0.8,
      cue: "re:litigation",
    };
  }
  // j. subsidiary IPO / M&A
  if (
    RE.subsidiaryIpo.test(body) &&
    /subsidiar|platforms limited|of [a-z .&]+ limited/i.test(body)
  ) {
    return {
      category: "m_and_a",
      subcategory: "subsidiary_ipo",
      confidence: 0.8,
      cue: "re:subsidiary-ipo",
    };
  }
  if (RE.licence.test(body)) {
    return {
      category: "press_release",
      subcategory: "approval",
      confidence: 0.8,
      cue: "re:approval",
    };
  }
  if (RE.mna.test(body)) {
    let sub: string | undefined;
    if (/incorporat/i.test(body) && /wholly|subsidiary|section 8/i.test(body))
      sub = "wos_incorporation";
    else if (/strike[- ]?off|dissolution|wind(ing)?[- ]up/i.test(body))
      sub = "restructuring";
    else if (/update on|updates on|in furtherance|completion of/i.test(body))
      sub = "update";
    return {
      category: "m_and_a",
      subcategory: sub,
      confidence: 0.8,
      cue: "re:mna",
    };
  }
  // k. fund raise
  if (RE.fundRaise.test(body)) {
    return {
      category: "fund_raise",
      subcategory: fundRaiseSubcategory(body),
      confidence: 0.8,
      cue: "re:fund-raise",
    };
  }
  // l. capex
  if (RE.capex.test(body))
    return { category: "capex", confidence: 0.8, cue: "re:capex" };
  // m. postal ballot / AGM-EGM
  if (RE.postalBallot.test(body)) {
    const sub = /result|scrutini|voting|completion/i.test(body)
      ? "results"
      : "notice";
    return {
      category: "postal_ballot",
      subcategory: sub,
      confidence: 0.9,
      cue: "re:postal-ballot",
    };
  }
  if (RE.agmEgm.test(body)) {
    const sub = /annual report/i.test(body)
      ? "annual_report"
      : /proceeding|scrutini|voting|outcome/i.test(body)
        ? "proceedings"
        : "notice";
    return {
      category: "agm_egm",
      subcategory: sub,
      confidence: 0.85,
      cue: "re:agm-egm",
    };
  }
  // n. investor meetings
  if (RE.investorMeet.test(body))
    return {
      category: "investor_meetings",
      confidence: 0.85,
      cue: "re:investor-meet",
    };
  // o. press release (order wins, product, rumour, CSR, generic)
  if (RE.orderWin.test(body))
    return {
      category: "press_release",
      subcategory: "order_win",
      confidence: 0.85,
      cue: "re:order-win",
    };
  if (RE.csr.test(body))
    return {
      category: "press_release",
      subcategory: "csr",
      confidence: 0.75,
      cue: "re:csr",
    };
  if (RE.pressGeneric.test(body)) {
    return {
      category: "press_release",
      subcategory: pressSubcategory(body),
      confidence: 0.75,
      cue: "re:press-generic",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stage C — LLM residue (batched)
// ---------------------------------------------------------------------------

export interface ResidueItem {
  id: string;
  symbol: string;
  desc: string;
  subject: string;
  /** voiceSummary or the first ~1,200 chars of attachment text */
  text?: string;
}

export interface ResidueResult {
  id: string;
  category: Category;
  tier: Tier;
  reason: string;
}

export type ResidueClassifier = (
  items: ResidueItem[],
) => Promise<ResidueResult[]>;

const ResidueSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      category: z.enum(CATEGORIES),
      tier: z.number().int().min(1).max(3),
      reason: z.string().max(200),
    }),
  ),
});

const RESIDUE_SYSTEM = `You classify Indian stock-exchange (NSE) corporate filings into exactly one of these categories:
results, m_and_a, fund_raise, management_change, litigation, insider_trading, earnings_call, investor_meetings, credit_rating, dividend, bonus_split, capex, press_release, postal_ballot, agm_egm, pledging, unclassified.
Rules: results = quarterly/annual results, board meeting approving them, decks, newspaper ads of results. m_and_a = acquisitions, mergers, demergers, JVs, subsidiary stake sales/IPOs. fund_raise = QIP/rights/preferential/buyback/NCD/CP. management_change = any director/KMP/auditor joining or leaving. litigation = regulatory orders, penalties, insolvency. insider_trading = promoter/insider trades. earnings_call = concall notice/transcript/recording. investor_meetings = analyst/investor meetings or conferences. credit_rating = rating agency actions. press_release = order wins, product news, partnerships, rumour clarifications. unclassified = routine paperwork (ESOP, certificates, trading window, registrar changes, CSR).
Tier: 1 = investor must see it (material money/people/legal event), 2 = worth one line, 3 = routine/filed away.
Use only the given text. Output JSON only.`;

/** Default residue classifier: one Flash-Lite call for up to 40 items, cached by content hash. */
export const llmResidueClassifier: ResidueClassifier = async (items) => {
  if (items.length === 0) return [];
  const lines = items.map((it) => {
    const txt = (it.text ?? "").replace(/\s+/g, " ").slice(0, 1200);
    return `### id=${it.id} | symbol=${it.symbol} | nse_subject=${it.desc}\nheadline: ${it.subject.slice(0, 400)}${txt ? `\ntext: ${txt}` : ""}`;
  });
  const r = await callStructured({
    task: "classify_residue",
    tier: "bulk",
    schema: ResidueSchema,
    system: RESIDUE_SYSTEM,
    prompt: `Classify each filing. Return one entry per id, in the same order.\n\n${lines.join("\n\n")}`,
    maxTokens: Math.min(8192, 120 + items.length * 60),
    promptVersion: "2",
  });
  log.info(
    {
      items: items.length,
      model: r.model,
      cached: r.cached,
      tokensIn: r.tokensIn,
    },
    "residue classified",
  );
  return r.data.items.map((it) => ({
    id: it.id,
    category: it.category,
    tier: it.tier as Tier,
    reason: it.reason,
  }));
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ClassifyContext {
  /** first time this ISIN+category appears in 180 days */
  seenBefore?: boolean;
  /** same ISIN+category items in the last 7 days (repetition decay) */
  recentSameCategory?: number;
  /** attachment text, when already downloaded */
  extraText?: string;
  /** market cap in rupees, for amount materiality */
  mcapInr?: number | null;
}

export function toClassification(
  raw: AnnouncementRaw,
  rule: RuleClassification,
  classifiedBy: Classification["classifiedBy"],
  ctx: ClassifyContext = {},
): Classification {
  const { priority, tier } = computePriority(
    raw,
    {
      category: rule.category,
      subcategory: rule.subcategory,
      classifiedBy,
      eventKey: "",
    },
    {
      seenBefore: ctx.seenBefore ?? false,
      recentSameCategory: ctx.recentSameCategory,
      extraText: ctx.extraText,
      mcapInr: ctx.mcapInr ?? undefined,
    },
  );
  return {
    category: rule.category,
    subcategory: rule.subcategory,
    tier,
    priority,
    classifiedBy,
    eventKey: eventKeyFor(raw, rule.category),
  };
}

/** Pure: rules (+ optional single-item LLM residue when `llm` is given). */
export async function classify(
  raw: AnnouncementRaw,
  opts: { llm?: ResidueClassifier | null; ctx?: ClassifyContext } = {},
): Promise<Classification> {
  const rule = classifyRules(raw, opts.ctx?.extraText);
  if (rule.confidence < RESIDUE_THRESHOLD && opts.llm) {
    const [res] = await opts.llm([toResidueItem(raw, opts.ctx?.extraText)]);
    if (res) {
      return toClassification(
        raw,
        { category: res.category, confidence: 0.7, cue: `llm:${res.reason}` },
        "llm",
        opts.ctx,
      );
    }
  }
  return toClassification(raw, rule, "rule", opts.ctx);
}

export function toResidueItem(
  raw: AnnouncementRaw,
  extraText?: string,
): ResidueItem {
  return {
    id: raw.seq_id,
    symbol: raw.symbol,
    desc: raw.desc,
    subject: raw.attchmntText,
    text:
      raw.voiceSummary ?? (extraText ? extraText.slice(0, 1200) : undefined),
  };
}

export interface ClassifyBatchOptions {
  /** null/undefined → rules only */
  llm?: ResidueClassifier | null;
  threshold?: number;
  maxItemsPerCall?: number;
  /** hard cap on LLM calls for this batch */
  maxCalls?: number;
  /** per-item context (novelty, attachment text, mcap) */
  ctxFor?: (raw: AnnouncementRaw) => ClassifyContext;
}

export interface ClassifiedItem {
  raw: AnnouncementRaw;
  rule: RuleClassification;
  classification: Classification;
  /** set when the LLM overrode / confirmed the rule */
  llmReason?: string;
}

/**
 * Classify many items: rules for all, then ONE batched LLM call per ≤ 40
 * low-confidence items (never more than `maxCalls`). Pure apart from the LLM.
 */
export async function classifyBatch(
  raws: AnnouncementRaw[],
  opts: ClassifyBatchOptions = {},
): Promise<ClassifiedItem[]> {
  const threshold = opts.threshold ?? RESIDUE_THRESHOLD;
  const perCall = opts.maxItemsPerCall ?? 40;
  const ctxFor: (raw: AnnouncementRaw) => ClassifyContext =
    opts.ctxFor ?? (() => ({}));
  const out: ClassifiedItem[] = raws.map((raw) => {
    const ctx = ctxFor(raw);
    const rule = classifyRules(raw, ctx.extraText);
    return {
      raw,
      rule,
      classification: toClassification(raw, rule, "rule", ctx),
    };
  });
  if (!opts.llm) return out;

  const residue = out.filter((o) => o.rule.confidence < threshold);
  if (residue.length === 0) return out;
  let calls = 0;
  const maxCalls = opts.maxCalls ?? Number.POSITIVE_INFINITY;
  for (let i = 0; i < residue.length; i += perCall) {
    if (calls >= maxCalls) {
      log.warn(
        { remaining: residue.length - i },
        "residue LLM budget exhausted — keeping rule results",
      );
      break;
    }
    const chunk = residue.slice(i, i + perCall);
    calls++;
    let results: ResidueResult[] = [];
    try {
      results = await opts.llm(
        chunk.map((c) => toResidueItem(c.raw, ctxFor(c.raw).extraText)),
      );
    } catch (e) {
      log.warn(
        { err: e instanceof Error ? e.message : String(e) },
        "residue LLM call failed — keeping rule results",
      );
      continue;
    }
    const byId = new Map(results.map((r) => [r.id, r]));
    for (const c of chunk) {
      const r = byId.get(c.raw.seq_id);
      if (!r) continue;
      const ctx = ctxFor(c.raw);
      const rule: RuleClassification = {
        category: r.category,
        // keep the rule's subcategory when the LLM agrees on the category (it carries routine/material nuance)
        subcategory:
          r.category === c.rule.category ? c.rule.subcategory : undefined,
        confidence: 0.7,
        cue: `llm:${r.reason}`,
      };
      c.rule = rule;
      c.llmReason = r.reason;
      c.classification = toClassification(c.raw, rule, "llm", ctx);
      // the model's tier is advisory: only let it demote to routine, never promote beyond the rules' priority model
      if (
        r.tier === 3 &&
        c.classification.tier < 3 &&
        r.category === "unclassified"
      ) {
        c.classification.tier = 3;
        c.classification.priority = Math.min(c.classification.priority, 20);
      }
    }
  }
  return out;
}
