# Presight Test Report Builder

Two ways to produce the same report. Use whichever suits.

| | For | How |
|---|---|---|
| **`report-builder.html`** | Anyone. No install. | Double-click it. Fill the form, click **Download report**. |
| **`generate_report.py`** | CI, or bulk/scripted runs | `python3 generate_report.py` |

Both share one renderer, so the same data produces an identical report either
way. `report_data.json` moves freely between them.

---

## The builder page

Open `report-builder.html` in any browser. No server, no install, nothing sent
anywhere — it runs entirely on your machine.

Left side is the form, right side is a live preview that updates as you type.

| Button | What it does |
|---|---|
| **Download report** | Saves the finished HTML report. Filename comes from the title. |
| **Save data** | Saves your entries as `report_data.json`, so you can reopen and amend later |
| **Load data** | Loads a previously saved `report_data.json` |
| **Reset** | Back to the sample data |

### What is calculated for you

Never typed, never out of sync:

- **Pass rate** and total instances — summed from the coverage table
- **Defect pie charts** — counted from the category and status columns
- **Open defect count** — anything whose status is not `closed`
- **Coverage bars** — each area's share of the total

Change a defect from `open` to `closed` and the status chart, the open count and
the two tables all follow in the preview.

### Fields

**Coverage by area** — one row per report type, module or suite. Passed and
failed counts drive everything else. The note column is free text shown beside
the bar.

**Defects** — one row each.

- **Category** — any text. Six common ones are suggested; a new category gets a
  colour automatically. Use the labels from your tracker, not invented ones, or
  the report cannot be reconciled against the backlog.
- **Status** — `closed` puts the row in the first table, anything else in the
  outstanding table.
- **Urgent** — highlights the row and drives the headline stat.

**Highlighted notes** — the coloured callouts. Leave blank to omit them.
Inline HTML such as `<strong>` works.

### Narrative sections

Strategy, constraints, methodology, AI limitations and recommendations are
carried from the loaded data and appear in the preview, but are not editable in
the form — they are long-form prose and are easier to write in a text editor.

To change them: **Save data** → open `report_data.json` → edit the `sections`
array → **Load data**.

---

## The command-line generator

```bash
python3 generate_report.py
python3 generate_report.py --data sprint24.json --out sprint24.html
```

Python 3.8 or later. No packages to install. Useful for generating a report at
the end of a CI run rather than by hand.

---

## Files

| File | Purpose |
|---|---|
| `report-builder.html` | The form UI. Self-contained — template, logo and sample data are embedded. |
| `generate_report.py` | Command-line generator |
| `report_data.json` | Sample data, and the format both tools read and write |
| `template.html` | Layout and Presight styling. Edit only to change the design. |
| `assets/presight-logo.png` | Embedded into every report |
| `builder_shell.html`, `builder_app.js` | Sources for the builder page — see below |

### Rebuilding the builder after a design change

`report-builder.html` is generated. If you edit `template.html`,
`builder_shell.html` or `builder_app.js`, rebuild it:

```bash
python3 build_builder.py
```

Otherwise the page keeps using the copy embedded at build time.

---

## Exporting to PDF

Open the report in Chrome, `Cmd + P`, destination **Save as PDF**, and **tick
Background graphics**. Without it the dark background prints white and the
charts lose their colour.

---

## A note on the numbers

These tools compute from what you give them. They cannot tell you whether the
counting basis is right — whether an "instance" is a country, a report run or a
test case. Agree that definition with your lead before the first report goes
out, and keep it the same afterwards. A pass rate that silently changes basis
between reports is worse than no pass rate at all.
