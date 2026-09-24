# Severity that knows the date (2026-09-24)

Why `retrospective` exists and severity's wording did not change. The script was
a throwaway: it re-asked Jev over a hand-labelled set, with every variant in one
request per headline so the variants were compared on identical states.

**The problem.** Jev's severity rates the event a report describes, whenever it
happened. Two Iranian pieces on the first hours of the 1980 Iraqi invasion
scored 0.99 (the top level: "war between states beginning"), and new studies of
North Korea's 2017 nuclear test 0.87–0.95. Both wore the "major" tag.

**Setup:** 227 headlines from the week to 2026-09-24, `jev-1.13.0`, title +
summary as production sends them, in 9 languages. The set:
- every article at the top level (27),
- a seeded draw across the other levels (145),
- headlines matching history words in six languages (35),
- 20 more picked from anniversary coverage.

I labelled each one by hand: is it chiefly about something long ago? 18 were;
most were about the Iran–Iraq war anniversary, plus a few new studies of old
events. 283k input tokens, $0.012.

Re-asking the unchanged severity question reproduced the stored scores
(median difference 0.003; 2 of 227 crossed the "major" line), so the
comparison measures wording, not noise.

| Variant | Looks-backs caught (of 18) | Current reports flagged | "Major" 92 → |
|---|---|---|---|
| `retrospective` Noul with criteria, at 0.7 | 15 | 0 (3 analysis pieces) | 86 |
| same, no criteria, at 0.7 | 15 | 0 (same 3) | — |
| severity asks about "the new development", not the war it belongs to | — | — | 65 |
| plus a top level naming situations only | — | — | 57 |

Both severity rewordings removed the history pieces. They also pushed real
events below "major": deadly clashes in Pakistan, Russian strikes on Kyiv,
Zaporizhzhia and Moscow, and, with the second, North Korea's ballistic missile
launches (0.66 → 0.38). The Noul alone removed 6 "major" tags: 5 looks back
and one analysis piece ("Is Iran's Pickaxe Mountain beyond the reach of US
bunker-busters?"). The 3 analysis pieces it flagged are not news reports either.

It misses a new study that is framed as news, e.g. "N.K.'s nuclear test may have
triggered over 1,300 earthquakes" (0.17). Ruling out analysis pieces as well, at
opinion ≥ 0.5, would have removed "Up to 169 killed in Yemen", so severity
gates on `retrospective` only.

**Watch:** a real current report scoring retrospective ≥ 0.7. None did here.
