/**
 * PDF text sometimes splits a word ("d isclosure", "Mechan ical",
 * "Di rector", "ed uc at ion"). Join those breaks for display.
 * The filing is still the source; this does not add a fact that was
 * not in the letters. Two real words stay two words.
 */

const WORDS = new Set(
  `a an the of to in on or and as at be by do go he if is it me my no so up we am us for from with over after before about than then this that these those was were been being has have had his her their its not but can will would should could may might also which who whom whose what when where why how there here such per via off out our you your they them into upon during within without between against under again further once both each few more most other some any own same too very just now only same
director directors disclosure relationship relationships appointment appointments case independent chairman managing president member members global leadership team group groups private limited venture ventures motor motors board boards legal entity entities india october march august september november december january february april june july through till taking various since led implemented model village villages higher education degree degrees bachelor master mechanical engineering university universities hold holds holding worked work working financial analyst analysts manufacturing engineer engineers project manager managers product products strategy strategic general management position positions foundation sustainable community initiative initiatives company companies experience previously prior role roles chief officer executive senior junior head business finance operations sales marketing human resources committee nomination remuneration audit risk compliance secretary whole time non appointed effective date dates year years served serve chaired chair chairperson inc ltd usa mba technology technologies cummins tata components component joint analyst rector president well four also which such from was has have
bachelor's master's`.split(/\s+/),
);

function known(word: string): boolean {
  return WORDS.has(word.toLowerCase());
}

/**
 * A space is removed only when the joined letters are a known word and at
 * least one fragment was not. A single short non-word tail ("Cumm ins")
 * is joined once. Neighbours such as "holds a" and "Mechanical Engineering"
 * are left as written.
 */
export function repairPdfWords(text: string): string {
  const spaced = text.replace(/([A-Za-z])['’]s(?=[a-z])/g, "$& ");
  const words: Array<{ start: number; end: number; text: string }> = [];
  for (const match of spaced.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)) {
    if (match.index == null) continue;
    words.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    });
  }
  if (!words.length) return spaced;

  const joinThrough = new Set<number>();
  let i = 0;
  while (i < words.length) {
    let best = i;
    let every = known(words[i]?.text ?? "");
    let acc = words[i]?.text ?? "";
    for (let j = i + 1; j < words.length && j <= i + 5; j++) {
      const prev = words[j - 1];
      const cur = words[j];
      if (!prev || !cur) break;
      const gap = spaced.slice(prev.end, cur.start);
      if (!/^\s+$/.test(gap)) break;
      acc += cur.text;
      if (acc.length > 24) break;
      if (!known(cur.text)) every = false;
      if (known(acc) && !every) best = j;
    }
    if (best === i) {
      const cur = words[i];
      const next = words[i + 1];
      if (cur && next && !known(cur.text)) {
        const gap = spaced.slice(cur.end, next.start);
        if (
          /^\s+$/.test(gap) &&
          /^[a-z]{1,3}$/.test(next.text) &&
          !known(next.text)
        ) {
          best = i + 1;
        }
      }
    }
    for (let k = i; k < best; k++) joinThrough.add(k);
    i = best + 1;
  }

  let out = "";
  let cursor = 0;
  for (let n = 0; n < words.length; n++) {
    const word = words[n];
    if (!word) continue;
    out += spaced.slice(cursor, word.start);
    out += word.text;
    if (joinThrough.has(n)) {
      const next = words[n + 1];
      cursor = next ? next.start : word.end;
    } else {
      cursor = word.end;
    }
  }
  out += spaced.slice(cursor);
  return out;
}
