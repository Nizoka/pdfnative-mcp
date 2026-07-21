# Charts guide (for AI agents)

Native vector charts arrived in **pdfnative-mcp v1.5.0** (on pdfnative v1.6.0's
`ChartBlock`). Charts are drawn as **pure PDF path operators** — no rasterisation,
no external dependency — and carry a tagged-PDF `/Figure` + `/Alt`, so they stay
PDF/A- and PDF/UA-safe.

## Two ways to draw a chart

| You want… | Use |
| --- | --- |
| A standalone chart page | The **`add_chart`** tool |
| A chart amongst headings / paragraphs / tables | A **`chart` block** inside `generate_basic_pdf` |

Both build the identical pdfnative block, so pick whichever composes better.

## Chart types

`bar` · `barH` (horizontal bar) · `line` (optional `markers`) · `pie` · `donut`.

- **Bar / barH / line** accept **multiple series** and an optional value `axis`.
- **Pie / donut** use **exactly one series** — each value becomes a slice.

## Minimal calls

```jsonc
// Standalone bar chart
{ "tool": "add_chart", "arguments": {
  "chartType": "bar",
  "title": "Quarterly revenue (k€)",
  "categories": ["Q1", "Q2", "Q3", "Q4"],
  "series": [
    { "label": "2025", "values": [120, 180, 150, 220] },
    { "label": "2026", "values": [140, 200, 190, 250] }
  ],
  "axis": { "grid": true },
  "colors": ["#3366cc", "#dc3912"]
}}
```

```jsonc
// Same chart embedded in a report
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Annual report",
  "blocks": [
    { "type": "heading", "text": "Revenue", "level": 1 },
    { "type": "paragraph", "text": "Revenue grew across every quarter." },
    { "type": "chart", "chartType": "line", "markers": true,
      "categories": ["Jan", "Feb", "Mar"],
      "series": [{ "label": "Signups", "values": [120, 180, 260] }] }
  ]
}}
```

## Fields

| Field | Notes |
| --- | --- |
| `chartType` (required) | One of the five types above. |
| `series` (required) | `[{ label, values[], color? }]`. Pie/donut: one series. |
| `categories` | X-axis / slice labels. Defaults to 1-based indices. |
| `axis` | `{ yMin?, yMax?, ticks?, grid? }` — bar/line only. Values are clamped to the plot band. |
| `legend` | `'bottom'` (default for multi-series/pie) or `'none'`. |
| `markers` | Draw point markers on line series. |
| `colors` | Palette override (per-series or per-slice), CSS hex like `#3366cc`. |
| `align` | `'left'` (default) / `'center'` / `'right'`. |
| `altText` | Tagged `/Alt`. **Auto-generated when omitted** — leave it out unless you need a specific description. |
| `pdfA` (`add_chart` only) | `pdfa1b` / `pdfa2b` / `pdfa2u` / `pdfa3b`. |

## Pitfalls

- **Colours are hex strings**, e.g. `"#3366cc"` (with or without the leading `#`). Do not pass RGB tuples.
- **Pie/donut ignore extra series** — pass exactly one.
- An explicit `axis.yMin`/`yMax` that excludes data is safe: values are clamped to the plot band (they never draw outside the chart rectangle).
- For **PDF/A** output, prefer `pdfa2b`; the auto alt text keeps the figure conformant.
