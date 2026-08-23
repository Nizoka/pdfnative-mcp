# Charts guide (for AI agents)

Native vector charts arrived in **pdfnative-mcp v1.5.0** (on pdfnative's
`ChartBlock`); **charts v2** arrived in **v1.6.0** (pdfnative v1.7.0). Charts are
drawn as **pure PDF path operators** — no rasterisation, no external dependency —
and carry a tagged-PDF `/Figure` + `/Alt`, so they stay PDF/A- and PDF/UA-safe.

## Two ways to draw a chart

| You want… | Use |
| --- | --- |
| A standalone chart page | The **`add_chart`** tool |
| A chart amongst headings / paragraphs / tables | A **`chart` block** inside `generate_basic_pdf` |

Both build the identical pdfnative block, so pick whichever composes better.

## Chart types (9)

`bar` · `barH` (horizontal bar) · `stackedBar` · `stackedBarH` · `line` (optional
`markers`) · `area` · `scatter` · `pie` · `donut`.

- **Cartesian kinds** (`bar`, `barH`, `stackedBar`, `stackedBarH`, `line`, `area`,
  `scatter`) accept **multiple series**, a value `axis`, an optional secondary
  `axis2` and an `xAxis`.
- **Stacked** kinds stack the series per category; `axis.scale: 'log'` is not
  available for them.
- **Scatter** positions every point by the series' `xValues` and needs a positional
  `xAxis.type` (`'linear'` or `'time'`).
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

```jsonc
// Stacked bar with data labels
{ "tool": "add_chart", "arguments": {
  "chartType": "stackedBar",
  "categories": ["North", "South", "East"],
  "series": [
    { "label": "Hardware", "values": [40, 25, 30] },
    { "label": "Services", "values": [20, 35, 15] }
  ],
  "dataLabels": { "suffix": " k€", "decimals": 0 }
}}
```

```jsonc
// Scatter on a log value axis, linear x axis
{ "tool": "add_chart", "arguments": {
  "chartType": "scatter",
  "xAxis": { "type": "linear", "grid": true },
  "axis": { "scale": "log" },
  "series": [{ "label": "Latency (ms)", "xValues": [1, 2, 4, 8, 16], "values": [12, 25, 60, 130, 400] }]
}}
```

```jsonc
// Dual-axis line: revenue (left) vs margin % (right), time x axis
{ "tool": "add_chart", "arguments": {
  "chartType": "line",
  "markers": true,
  "xAxis": { "type": "time", "ticks": 4 },
  "axis": { "yMin": 0 },
  "axis2": { "yMin": 0, "yMax": 100 },
  "series": [
    { "label": "Revenue", "xValues": ["2026-01-01", "2026-04-01", "2026-07-01"], "values": [120, 150, 170] },
    { "label": "Margin %", "xValues": ["2026-01-01", "2026-04-01", "2026-07-01"], "values": [31, 34, 36], "yAxis": "right" }
  ]
}}
```

## Fields

| Field | Notes |
| --- | --- |
| `chartType` (required) | One of the nine kinds above. |
| `series` (required) | `[{ label, values[], color?, xValues?, yAxis? }]`. Pie/donut: one series. `xValues` (numbers, or ISO-8601 dates / epoch ms for a time axis) must match `values` in length. `yAxis: 'right'` binds the series to `axis2`. |
| `categories` | X-axis / slice labels. Defaults to 1-based indices. Ignored for positional x axes. |
| `axis` | `{ yMin?, yMax?, ticks?, grid?, scale? }` — left value axis (cartesian kinds). `scale: 'log'` needs strictly positive values and no stacking. Values are clamped to the plot band. |
| `axis2` | `{ yMin?, yMax?, ticks?, scale? }` — secondary **right** value axis; drawn only when a series sets `yAxis: 'right'`. |
| `xAxis` | `{ type?: 'category' \| 'linear' \| 'time', min?, max?, ticks?, grid? }`. `'category'` (default) positions by index; `'linear'` / `'time'` position by `xValues` (line / area / scatter). Time ticks are UTC-deterministic. |
| `dataLabels` | `true`, or `{ decimals?, prefix?, suffix? }` — per-point value labels. |
| `labelStride` | Draw every Nth category label. **Default: automatic** — overlapping labels are thinned by measurement (pdfnative 1.7). `1` draws every label (the pre-1.7 behaviour). |
| `labelRotation` | Rotate category labels counter-clockwise (0–90°); disables the automatic stride. |
| `legend` | `'bottom'` (default for multi-series/pie) or `'none'`. |
| `markers` | Draw point markers on line series. |
| `colors` | Palette override (per-series or per-slice), CSS hex like `#3366cc`. |
| `align` | `'left'` (default) / `'center'` / `'right'`. |
| `width` / `height` | Plot width (clamped to the content width, default 460) / plot-area height (default 240), in points. |
| `altText` | Tagged `/Alt`. **Auto-generated when omitted** — leave it out unless you need a specific description. |
| `pdfA` (`add_chart` only) | `pdfa1b` / `pdfa2b` / `pdfa2u` / `pdfa3b`. |
| `print` / `metadata` / `outputIntent` / `embedFonts` / `strict` / `includeDiagnostics` (`add_chart` only) | Print-production and PDF/A options shared by every document tool — see [PRINT.md](PRINT.md) and [PDFA.md](PDFA.md). |

## Pitfalls

- **Colours are hex strings**, e.g. `"#3366cc"` (with or without the leading `#`). Do not pass RGB tuples.
- **Pie/donut ignore extra series** — pass exactly one.
- **Cross-field rules are enforced by the engine**, not by the JSON Schema, so they come back as
  `CHART_ERROR` with the remedy in the message: log scale with zero / negative values, log scale
  on a stacked kind, `scatter` without `xValues`, `xValues` length not matching `values`, a
  positional `xAxis` on a bar kind, `yAxis: 'right'` on pie / donut. The same applies to a
  `chart` block inside `generate_basic_pdf`.
- An explicit `axis.yMin`/`yMax` that excludes data is safe: values are clamped to the plot band (they never draw outside the chart rectangle).
- **Crowded category labels are thinned automatically** since v1.6.0. If you relied on every
  label being drawn (and accepted overlap), pass `labelStride: 1` — output is otherwise
  byte-identical to v1.5.0 when labels did not overlap.
- For **PDF/A** output, prefer `pdfa2b`; the auto alt text keeps the figure conformant. A
  *valid* PDF/A claim also needs `embedFonts: true` for the axis / legend text (see PDFA.md).
