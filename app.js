// Frontend wiring for the Glicko-2 player leaderboard.
// - Loads leaderboard.json (table data) and histories.json (per-player trajectories)
// - Initializes DataTables with region/country filters
// - Dynamic rank: rank cells reflect rank within the active Region/Country
//   subset, not the global rank or the text-search subset
// - Row click → modal with rating chart (with ±RD confidence band) and a
//   tournament-by-tournament results table

let table = null;
let chartInstance = null;
let leaderboardData = null;
let histories = null;

async function init() {
    try {
        const [lbResp, hiResp] = await Promise.all([
            fetch("leaderboard.json", { cache: "no-cache" }),
            fetch("histories.json",   { cache: "no-cache" }),
        ]);
        if (!lbResp.ok) throw new Error(`leaderboard.json HTTP ${lbResp.status}`);
        if (!hiResp.ok) throw new Error(`histories.json HTTP ${hiResp.status}`);
        leaderboardData = await lbResp.json();
        histories = await hiResp.json();
    } catch (err) {
        document.querySelector("main").innerHTML =
            `<p style="color: #c00; padding: 16px;">Failed to load data: ${err.message}</p>`;
        return;
    }

    initFilters();
    initCutoffLabel();
    initTable();
    initModalDismiss();
}

// ---------- cutoff label ----------

function initCutoffLabel() {
    const cutoff = histories && histories.cutoff_date;
    if (!cutoff) return;
    const hint = document.querySelector(".filter-hint");
    if (!hint) return;
    const note = document.createElement("span");
    note.className = "cutoff-note";
    note.textContent = `Δ since ${cutoff}`;
    hint.before(note);
}

// ---------- filters ----------

function initFilters() {
    const countryByRegion = {};
    const allCountries = new Set();
    for (const p of leaderboardData) {
        if (!p.country) continue;
        allCountries.add(p.country);
        if (!countryByRegion[p.region]) countryByRegion[p.region] = new Set();
        countryByRegion[p.region].add(p.country);
    }

    const countrySelect = document.getElementById("country-filter");
    const populateCountries = (region) => {
        const set = region ? (countryByRegion[region] || new Set()) : allCountries;
        const sorted = [...set].sort();
        countrySelect.innerHTML = '<option value="">All countries</option>';
        for (const c of sorted) {
            const opt = document.createElement("option");
            opt.value = c;
            opt.textContent = c;
            countrySelect.appendChild(opt);
        }
    };
    populateCountries("");

    // Stash on window for re-use inside change handlers below
    window.__populateCountries = populateCountries;
}

// ---------- table ----------

function initTable() {
    table = $("#leaderboard").DataTable({
        data: leaderboardData,
        columns: [
            { data: "rank" },
            { data: "name" },
            { data: "country" },
            { data: "region" },
            { data: "rating", render: r => r.toFixed(2) },
            { data: "rd",     render: r => r.toFixed(1) },
            { data: "games" },
            {
                data: null,
                orderable: false,
                render: r => `${r.wins}-${r.losses}-${r.ties}`,
            },
        ],
        order: [[0, "asc"]],
        pageLength: 25,
        lengthMenu: [10, 25, 50, 100],
        responsive: true,
        language: { search: "Search players:" },
    });

    table.on("draw", updateRanks);
    // DataTables' synchronous init already fired its first draw before the
    // listener above was attached, so paint the deltas once on initial load.
    updateRanks();

    $("#region-filter").on("change", function () {
        const region = $(this).val();
        table.column(3).search(region ? `^${region}$` : "", true, false).draw();
        window.__populateCountries(region);
        table.column(2).search("").draw();
    });
    $("#country-filter").on("change", function () {
        const country = $(this).val();
        table.column(2).search(country ? `^${country}$` : "", true, false).draw();
    });

    // Row click → modal
    $("#leaderboard tbody").on("click", "tr", function () {
        const rowData = table.row(this).data();
        if (rowData && rowData.name) showPlayerModal(rowData);
    });
}

// Renumber the rank column from the Region/Country selection only. The
// free-text search doesn't redefine the subset. Also renders the F1-style
// position-change indicator (global delta) when no filter is active.
function updateRanks() {
    const totalRows = leaderboardData.length;
    const selectedRegion  = $("#region-filter").val();
    const selectedCountry = $("#country-filter").val();
    const cutoff = histories && histories.cutoff_date;

    let subset = leaderboardData;
    if (selectedRegion)  subset = subset.filter(r => r.region  === selectedRegion);
    if (selectedCountry) subset = subset.filter(r => r.country === selectedCountry);

    if (subset.length === 0) return;
    const isFiltered = subset.length < totalRows;

    const sortedByRating = subset.slice().sort((a, b) => a.rank - b.rank);
    const filterRank = new Map();
    sortedByRating.forEach((row, i) => filterRank.set(row.name, i + 1));

    table.rows({ search: "applied", page: "current" }).every(function (rowIdx) {
        const d = this.data();
        const fr = filterRank.get(d.name);
        const displayRank = fr !== undefined ? fr : d.rank;
        const cellNode = table.cell(rowIdx, 0).node();
        if (!cellNode) return;

        let html = `<span class="rank-num">${displayRank}</span>`;
        let titleParts = [];
        if (isFiltered) titleParts.push(`Global rank: ${d.rank}`);

        if (cutoff && !isFiltered) {
            if (d.prev_rank == null) {
                html += ` <span class="rank-delta new">NEW</span>`;
                titleParts.push(`Newly eligible since ${cutoff}`);
            } else {
                const delta = d.prev_rank - d.rank;
                if (delta > 0) {
                    html += ` <span class="rank-delta up">▲${delta}</span>`;
                    titleParts.push(`Up ${delta} from #${d.prev_rank} since ${cutoff}`);
                } else if (delta < 0) {
                    html += ` <span class="rank-delta down">▼${-delta}</span>`;
                    titleParts.push(`Down ${-delta} from #${d.prev_rank} since ${cutoff}`);
                } else {
                    html += ` <span class="rank-delta same">—</span>`;
                    titleParts.push(`Unchanged since ${cutoff}`);
                }
            }
        }

        cellNode.innerHTML = html;
        if (titleParts.length) {
            cellNode.setAttribute("title", titleParts.join(" · "));
        } else {
            cellNode.removeAttribute("title");
        }
    });
}

// ---------- modal ----------

function initModalDismiss() {
    document.querySelectorAll("[data-dismiss]").forEach(el => {
        el.addEventListener("click", hidePlayerModal);
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") hidePlayerModal();
    });
}

function showPlayerModal(player) {
    const history = histories.players[player.name];
    if (!history || history.length === 0) return;

    document.getElementById("modal-player-name").textContent = player.name;
    document.getElementById("modal-location").textContent =
        `${player.country || "—"} · ${player.region}`;
    document.getElementById("modal-rank").textContent = `Global rank #${player.rank}`;
    document.getElementById("modal-rating").textContent =
        `${player.rating.toFixed(2)} ±${player.rd.toFixed(1)}`;
    document.getElementById("modal-record").textContent =
        `${player.games} games · ${player.wins}-${player.losses}-${player.ties}`;

    // Peak rating
    let peakRating = -Infinity, peakTid = null;
    for (const snap of history) {
        if (snap[1] > peakRating) {
            peakRating = snap[1];
            peakTid = snap[0];
        }
    }
    const peakMeta = peakTid ? histories.tournaments[peakTid] : null;
    document.getElementById("modal-peak").textContent =
        peakMeta ? `Peak ${peakRating.toFixed(2)} at ${peakMeta[0]} (${peakMeta[1]})`
                 : `Peak ${peakRating.toFixed(2)}`;

    document.getElementById("player-modal").hidden = false;
    document.body.classList.add("modal-open");

    renderChart(history);
    renderTournamentTable(history);
}

function hidePlayerModal() {
    document.getElementById("player-modal").hidden = true;
    document.body.classList.remove("modal-open");
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
}

// ---------- chart ----------

function renderChart(history) {
    const ctx = document.getElementById("rating-chart").getContext("2d");
    if (chartInstance) chartInstance.destroy();

    const labels = history.map(snap => {
        const meta = histories.tournaments[snap[0]];
        return meta ? meta[1] : snap[0];   // ISO date for the x-tick
    });
    const ratings = history.map(snap => snap[1]);
    const rds     = history.map(snap => snap[2]);
    const upper   = ratings.map((r, i) => r + rds[i]);
    const lower   = ratings.map((r, i) => r - rds[i]);

    chartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [
                // Upper band — invisible line, fills DOWN to the lower band dataset.
                {
                    label: "Upper",
                    data: upper,
                    borderWidth: 0,
                    pointRadius: 0,
                    fill: "+1",
                    backgroundColor: "rgba(220, 38, 38, 0.12)",
                    tension: 0.25,
                },
                // Lower band — invisible line, anchor for the upper's fill.
                {
                    label: "Lower",
                    data: lower,
                    borderWidth: 0,
                    pointRadius: 0,
                    tension: 0.25,
                },
                // Rating line — the visible thing.
                {
                    label: "Rating",
                    data: ratings,
                    borderColor: "#dc2626",
                    backgroundColor: "#dc2626",
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    tension: 0.25,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    filter: (item) => item.dataset.label === "Rating",
                    callbacks: {
                        title: (items) => {
                            const idx = items[0].dataIndex;
                            const meta = histories.tournaments[history[idx][0]];
                            return meta ? `${meta[0]} · ${meta[1]}` : "";
                        },
                        label: (item) => {
                            const idx = item.dataIndex;
                            const r = history[idx][1];
                            const rd = history[idx][2];
                            return `Rating: ${r.toFixed(2)} ±${rd.toFixed(1)}`;
                        },
                    },
                    backgroundColor: "rgba(10, 10, 10, 0.88)",
                    titleFont: { size: 12, weight: "600" },
                    bodyFont: { size: 12 },
                    padding: 10,
                    cornerRadius: 6,
                    displayColors: false,
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: 8,
                        maxRotation: 0,
                        font: { size: 11 },
                        color: "#71717a",
                    },
                },
                y: {
                    grid: { color: "#f4f4f5" },
                    border: { display: false },
                    ticks: {
                        font: { size: 11 },
                        color: "#71717a",
                    },
                },
            },
        },
    });
}

// ---------- tournament history table ----------

function renderTournamentTable(history) {
    const tbody = document.querySelector("#tournament-history tbody");
    tbody.innerHTML = "";

    const ratings = history.map(s => s[1]);
    // Δ for snapshot[i] = rating[i] - rating[i-1], with snapshot[0] vs initial 1500.
    const deltas = history.map((s, i) => i === 0 ? s[1] - 1500 : s[1] - ratings[i - 1]);

    // Display most-recent first.
    for (let i = history.length - 1; i >= 0; i--) {
        const [tid, rating, rd, w, l, t, placement, _points] = history[i];
        const meta = histories.tournaments[tid];
        const tName = meta ? meta[0] : tid;
        const tDate = meta ? meta[1] : "";
        const finish = placement > 0 ? `#${placement}` : "—";
        const record = `${w}-${l}-${t}`;
        const delta = deltas[i];
        const deltaStr = (delta >= 0 ? "+" : "") + delta.toFixed(2);
        const deltaClass = delta >= 0 ? "delta-pos" : "delta-neg";

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td class="t-date">${tDate}</td>
            <td class="t-name">${escapeHtml(tName)}</td>
            <td class="t-finish">${finish}</td>
            <td class="t-record">${record}</td>
            <td class="t-delta ${deltaClass}">${deltaStr}</td>
            <td class="t-rating">${rating.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
}

document.addEventListener("DOMContentLoaded", init);
