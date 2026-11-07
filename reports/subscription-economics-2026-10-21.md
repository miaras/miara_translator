# Subscription economics — October 21, 2026

This is a proposal, not a change to live subscription billing.

## Measurement

Eight real API calls through the app's translation function: one original synthetic public-services essay (426 source tokens), translated English→Spanish/French/Chinese/Arabic and each result translated back to English. Source counts use the app's o200k_base tokenizer. GPT-6.1 Sol, Standard tier, low reasoning, structured sentence alignment, summary, and terminology output; actual provider usage captured. No customer documents were used. Total uncached-price API cost: $0.14.

Spanish, English, Chinese, French, and Arabic were selected as a demand proxy from [Slides Translator's published Q1 2025 target-language counts](https://blog.automagicalapps.com/2025-multilingual-translation-trends-data-driven-insights/). This is one product's audience, not a global top-five ranking or Shiroko usage ranking.

Costs below are per SOURCE token, not per provider input token or page. Every request produced structured output containing source and target sentences; those output and other overhead tokens are included. The normalized amounts are linear extrapolations from small samples, not measured 50,000-token documents. No long-document context carryover, retries, improvements, or regeneration workload was benchmarked. No reasoning tokens or cached inputs were reported in these eight responses; other tasks can use them.

## Provider rates

[OpenAI official pricing](https://developers.openai.com/api/docs/pricing), per million provider tokens:

| Tier | Input | Output | Cost multiplier |
|---|---:|---:|---:|
| Standard | $2 | $10 | 1× |
| Fast | $4 | $20 | 2× |
| Ultrafast | $12 | $60 | 6× |

Fast and Ultrafast below are price-scaled projections of the measured Standard usage. Their actual token usage and latency were not measured.

## Language and direction sensitivity

Estimated API cost for 50,000 source tokens:

| Direction | Sample source tokens | Sample provider input/output | Standard | Fast projected | Ultrafast projected |
|---|---:|---:|---:|---:|---:|
| English → Spanish | 426 | 638 / 1621 | $2.05 | $4.10 | $12.31 |
| Spanish → English | 571 | 773 / 1610 | $1.55 | $3.09 | $9.27 |
| English → French | 426 | 638 / 1404 | $1.80 | $3.60 | $10.79 |
| French → English | 612 | 814 / 1663 | $1.49 | $2.98 | $8.95 |
| English → Chinese | 426 | 638 / 1625 | $2.06 | $4.11 | $12.34 |
| Chinese → English | 568 | 770 / 1603 | $1.55 | $3.09 | $9.28 |
| English → Arabic | 426 | 638 / 1696 | $2.14 | $4.28 | $12.84 |
| Arabic → English | 622 | 824 / 1666 | $1.47 | $2.94 | $8.83 |

An equal-source-token mix across the eight measured directions gives $1.76 per 50,000 Standard source tokens. Observed direction range: $1.47–$2.14. These are sample results, not permanent language tariffs; topic, sentence lengths, context, and draft quality can change costs.

## One shared allowance across all speeds

Use one monthly allowance of Standard-equivalent source tokens. Standard consumes 1 allowance token per source token, Fast consumes 2, and Ultrafast consumes 6. This keeps the projected API cost of a fully used allowance similar across speed selections while provider rates maintain the measured multipliers.

| Plan | Monthly price | All Standard | All Fast | All Ultrafast |
|---|---:|---:|---:|---:|
| Personal | $9.00 | 50,000 | 25,000 | 8,333 |
| Plus | $19.00 | 120,000 | 60,000 | 20,000 |
| Pro | $99.00 | 650,000 | 325,000 | 108,333 |

Example on Personal: 20,000 Standard + 9,000 Fast + 2,000 Ultrafast source tokens consume 20,000 + 18,000 + 12,000 = 50,000 allowance tokens. Total actual source tokens translated are 31,000. Regeneration and improvement also consume allowance for their submitted source; repeated review work is not free.

## Polar fees and monthly contribution

[Polar Starter pricing](https://polar.sh/resources/pricing): 5% + $0.50 per transaction. No extra subscription surcharge on Starter; +1.5% applies to non-US cards. The grandfathered Early Member rate is different. The calculations below use Starter, domestic cards, pre-tax transactions, and full monthly allowance consumption.

| Plan | Price | Polar base fee | API cost observed range | Contribution after API + Polar | Contribution margin range |
|---|---:|---:|---:|---:|---:|
| Personal | $9.00 | $0.95 | $1.47–$2.14 | $5.91–$6.58 | 65.7%–73.1% |
| Plus | $19.00 | $1.45 | $3.53–$5.14 | $12.41–$14.02 | 65.3%–73.8% |
| Pro | $99.00 | $5.45 | $19.13–$27.82 | $65.73–$74.42 | 66.4%–75.2% |

These contributions are not net profit. They exclude hosting, support, free users, referral costs, refunds, disputes, taxes, international-card additions, payout fees, and any billing-rate difference on the actual account. Polar's percentage fee can apply to the tax-inclusive payment. Payout fees listed by Polar include $2 per active payout month, 0.25% + $0.25 per payout, and possible cross-border fees.

## Conservative operating budget

Budget 50% more than the highest measured directional API cost, rather than assuming a favorable language mix. This is an illustrative safety margin, not a guarantee on unseen workloads.

| Plan | Buffered API budget | Polar base fee | Contribution before other expenses |
|---|---:|---:|---:|
| Personal | $3.21 | $0.95 | $4.84 |
| Plus | $7.71 | $1.45 | $9.84 |
| Pro | $41.74 | $5.45 | $51.81 |

At the same full allowance, weighted faster-tier usage has the same projected API budget; pricing multipliers must stay aligned with provider costs. A non-US card reduces monthly contribution by another $0.14 on Personal, $0.28 on Plus, $1.48 on Pro before tax effects.

## Trial and referral economics with subscriptions

Use token allowances rather than ambiguous dollar credits for new subscription offers. One possible structure: 1,000 Standard-equivalent trial tokens per verified new signup; 5,000 extra allowance tokens to each person after the friend's first successful paid subscription charge, awarded once. No stacking with a separate promotional signup award. Existing credits would need a separately specified migration policy; no migration is implemented here.

Using the buffered high-cost estimate, trial cost is $0.06 per signup and the two-sided referral bonus costs $0.64 per paying referral. Personal's buffered contribution after its full regular allowance, Polar fee, and both referral bonuses is $4.20 in month one.

For 1,000 referred signups, assume all trial tokens, all referral bonuses, and all paid allowances are consumed, every buyer chooses Personal, and no existing inviter revenue or repeat months are counted:

| Signup-to-paid conversion | Subscribers | Month-one subscription revenue | Contribution after API, Polar, all trials, and referral bonuses |
|---|---:|---:|---:|
| 2.0% | 20 | $180.00 | $19.74 |
| 3.0% | 30 | $270.00 | $61.71 |
| 5.0% | 50 | $450.00 | $145.65 |

Use 3–5% as a planning scenario and 2% as a stress test, not as a forecast. [ChartMogul's broader self-serve freemium study](https://chartmogul.com/reports/saas-conversion-report/) calls 3–5% good within six months; subscription pricing and this app's consumer essay audience can perform differently. The month-one table above applies conversion hypothetically to a cohort without modeling the time users take to convert. Retention is unknown: a one-essay customer may pay once and cancel.

## Subscription rules proposed

Reset included allowance each billing cycle; no unlimited translation or unlimited rollover. Keep prepaid purchases for one-off customers and optional top-ups. Require an explicit top-up purchase instead of charging unexpected overages. Preserve access to saved documents after cancellation. Stop renewal on cancellation while keeping the current paid period available. Treat human review as a separate manual service, not an unlimited subscription benefit. Add annual billing only after measuring retention and costs.

## Human Review economics

English ↔ Korean only, more languages coming soon. Proposed fixed price: $0.04 per English word, $10 minimum; 250 English words is one standardized page. Count English source words for English→Korean and English draft words for Korean→English. Physical PDF page count is not used for price.

| Work size | Standardized pages | Customer price | Polar Starter base fee | Remaining after Polar |
|---|---:|---:|---:|---:|
| 250 English words | 1 | $10.00 | $1.00 | $9.00 |
| 1,000 English words | 4 | $40.00 | $2.50 | $37.50 |
| 5,000 English words | 20 | $200.00 | $10.50 | $189.50 |

At an assumed 1,000 English words reviewed per hour, a 1,000-word job leaves $30 for reviewer labor and $7.50 for administration after Polar. Review speed is a business assumption, not a measured English–Korean benchmark; complex drafts can take longer. Capacity of 20 standardized pages/day equals 5,000 English words/day, or 5 working hours at that assumed speed. Review backlog turnaround = ceiling((pending English words ahead + this job's English words) / 5,000) days; display as an estimate, not a guaranteed delivery time. Human review intake is being implemented separately; payment collection is not yet integrated.
