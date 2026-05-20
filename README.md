# Porygon-R

A Glicko-2 ranking system for competitive Pokémon TCG players, computed from tournament data.

**Live site:** https://reillyowencooper.github.io/porygon-r/

## What it is

Every player accrues a rating based on how they've performed against the field across Regionals, Internationals, Special Events, and Worlds. The rating accounts for opponent strength — beating top players moves a rating more than beating the average grinder — and carries a confidence band (RD) so you can see how settled each rating is. Click any player on the leaderboard to see their full rating trajectory over time and a tournament-by-tournament breakdown.

## Methodology

- **Algorithm:** [Glicko-2](http://www.glicko.net/glicko.html) (Glickman 2012)
- **Rating period:** one per tournament
- **System constant:** τ = 0.5
- **Starting values:** rating 1500 · RD 350 · volatility 0.06
- **Eligibility:** at least 35 rounds played and final RD ≤ 100
- **Identity matching:** case-insensitive (`RYUKI OKADA` and `Ryuki Okada` are one player)
- **Division:** Masters only
- **Bans:** players banned from sanctioned play are excluded

More detail in the "Details" footer on the live site.

## Issues, ideas, contributions

Open a [GitHub issue](../../issues) for bug reports, missing-tournament gaps, identity-merging weirdness, or feature ideas. Frontend PRs welcome.

## Attribution

All tournament data comes from a combination of Limitless Labs and RK9 data. This project is unaffiliated with The Pokémon Company, Limitless, or RK9, but is extraordinarily grateful for the wonderful resources that Limitless and Rk9 have put together.
