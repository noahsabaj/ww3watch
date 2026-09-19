# Jev vs. the retired LLM classifier — relevance (2026-09-19)

The evaluation that justified making Jev the relevance judge. The script that
produced it (`scripts/eval-jev.ts`, removed — see git history at `96ceb16`)
compared Jev's P(relevant) with the LLM's stored verdicts; those `llm` reject
rows age out after 14 days, so it cannot be re-run. The forward-looking check is
`scripts/jev-regression.ts`.

**Setup:** 1,475 titles with LLM verdicts, 7 languages, seeded sample, titles
only (rejects keep no summary; production also sends the summary), zero-shot,
`jev-1.13.0`. 19 s, $0.057.

| lang | n | AUC | agreement @ 0.5 |
|---|---|---|---|
| all | 1475 | 0.956 | 87.9% |
| en | 400 | 0.969 | 89.8% |
| fa | 300 | 0.933 | 85.3% |
| ru | 300 | 0.949 | 86.3% |
| ar | 200 | 0.972 | 91.0% |
| he | 120 | 0.980 | 91.7% |
| tr | 72 | 0.960 | 87.5% |
| uk | 83 | 0.962 | 80.7% |

Bands ≤0.2 / ≥0.8 settled 74% at 4.1% false-accept / 3.5% false-reject against
the LLM's labels. The English disagreements, read by hand, were borderline
stories rather than misses (South Korea and Hormuz, Macron's G7 on hybrid
attacks). Turkish and Ukrainian false-accepts were 27–30% on ~80 titles each —
too few to conclude from; watch `stats.cls_jev.borderline` and the head audit.

**Scope note found later:** Jev's question is narrower than the LLM's prompt was.
Domestic politics of states at war (an election, a pro-government rally) scores
low. That is a property of the question in `src/lib/server/jev.ts`, not of the
model — widen the question, not the threshold, if that coverage is wanted.
